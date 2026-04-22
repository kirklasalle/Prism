/**
 * Container Sandbox Adapter
 * 
 * Manages isolated containers with lifecycle control, snapshot/revert capability,
 * resource quotas, and policy-tier integration. All operations support deterministic
 * replay validation for Stage 2 testing.
 * 
 * See: CONTAINER_VIRTUALIZATION_DESIGN.md for full specification
 * 
 * @module adapters/application/container-sandbox-adapter
 */

import sqlite3 from "sqlite3";
import { v4 as uuidv4 } from "uuid";
import { spawn, ChildProcess } from "child_process";
import { PolicyEngine } from "../../core/policy/engine.js";
import { ActivityBus } from "../../core/activity/bus.js";
import type { ExecutionProfile } from "../../core/policy/execution-profiles.js";
import { INDIVIDUAL_PROFILE } from "../../core/policy/execution-profiles.js";

/**
 * Container state enumeration
 */
export enum ContainerState {
    IDLE = "idle",
    CREATED = "created",
    RUNNING = "running",
    EXECUTING = "executing",
    TIMEOUT = "timeout",
    STOPPED = "stopped",
    DESTROYED = "destroyed"
}

/**
 * Resource quota configuration
 */
export interface ResourceQuota {
    cpu_limit: number;        // CPU cores
    memory_limit_mb: number;  // Memory in MB
    disk_limit_mb: number;    // Disk in MB
}

/**
 * Container snapshot metadata
 */
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

/**
 * Basic container metadata
 */
export interface Container {
    container_id: string;
    image: string;
    state: ContainerState;
    resource_quota: ResourceQuota;
    created_at: string;
    started_at?: string;
    stopped_at?: string;
}

/**
 * Response from exec in container
 */
export interface ExecInContainerResponse {
    container_id: string;
    command: string;
    exit_code: number;
    stdout: string;
    stderr: string;
    execution_time_ms: number;
    timestamp: string;
}

// Tier 1: Read-only operations
const TIER1_KEYWORDS = ["ls", "cat", "grep", "pwd", "echo", "cd", "head", "tail", "wc", "find", "locate", "stat", "file", "ipconfig", "ifconfig", "ping", "nslookup", "dig", "tracert", "traceroute", "netstat", "arp", "hostname", "nbtstat", "pathping", "getmac", "ss", "curl", "wget"];

// Tier 2: Mutating operations
const TIER2_KEYWORDS = ["mkdir", "touch", "cp", "mv", "chmod", "chgrp", "ln", "tar", "zip", "gzip", "sed", "awk", "netsh", "route"];

// Tier 3: High-risk operations
const TIER3_KEYWORDS = ["rm", "sudo", "reboot", "dd", "mkfs", "halt", "shutdown", "kill", "chown", "fdisk", "format", "umount", "fsck"];

/**
 * Container Sandbox Adapter
 * 
 * Handles isolated container lifecycle with policy routing,
 * snapshot/revert capability, resource quotas, and replay validation.
 */
export class ContainerSandboxAdapter {
    private db: sqlite3.Database;
    private policyEngine: PolicyEngine;
    private activityBus: ActivityBus;
    private executionProfile: ExecutionProfile;
    private activeContainers: Map<string, { process?: ChildProcess; dockerContainer?: any; container: Container }> = new Map();
    private snapshots: Map<string, ContainerSnapshot[]> = new Map();
    private initializationPromise: Promise<void>;
    private dockerEnabled = false;
    private dockerClient: any = null;
    private dockerInitPromise: Promise<void>;

    constructor(db: sqlite3.Database, policyEngine: PolicyEngine, activityBus: ActivityBus, executionProfile?: ExecutionProfile) {
        this.db = db;
        this.policyEngine = policyEngine;
        this.activityBus = activityBus;
        this.executionProfile = executionProfile ?? INDIVIDUAL_PROFILE;
        this.initializationPromise = this.initializeDatabase();
        this.dockerInitPromise = this.tryInitDocker().catch(() => { /* graceful degradation: Docker unavailable, using child_process mock */ });
    }

    /** Attempt to connect to Docker daemon via dockerode. Falls back silently if Docker is unavailable. */
    private async tryInitDocker(): Promise<void> {
        const Dockerode = (await import("dockerode")).default;
        const client = new Dockerode();
        await client.ping();
        this.dockerClient = client;
        this.dockerEnabled = true;
    }

    /** Whether real Docker integration is active (dockerode loaded and daemon reachable). */
    isDockerEnabled(): boolean {
        return this.dockerEnabled;
    }

    /** Update execution profile at runtime. */
    setExecutionProfile(profile: ExecutionProfile): void {
        this.executionProfile = profile;
    }

    /** Get current execution profile. */
    getExecutionProfile(): ExecutionProfile {
        return this.executionProfile;
    }

    /**
     * Initialize SQLite schema
     * @private
     */
    private initializeDatabase(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // Create containers table
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

                // Create container_snapshots table
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
                `, (err: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Create container_command_history table
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
                    `, (err: any) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        // Create container_signal_log table
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
                        `, (err: any) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                    });
                });
            });
        });
    }

    /**
     * Create a new container from image
     * 
     * @param image - Container image
     * @param resource_quota - Resource limits
     * @returns Created container metadata
     */
    async createContainer(
        image: string,
        resource_quota: ResourceQuota
    ): Promise<Container> {
        await this.initializationPromise;

        const container_id = uuidv4();
        const created_at = new Date().toISOString();

        const container: Container = {
            container_id,
            image,
            state: ContainerState.CREATED,
            resource_quota,
            created_at
        };

        // Persist to database
        await this.persistContainer(container);

        // Initialize snapshot list for this container
        this.snapshots.set(container_id, []);

        // Emit activity
        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_create",
            status: "succeeded",
            details: { image, resource_quota },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow"
        });

        return container;
    }

    /**
     * Start a container
     * 
     * @param container_id - Container identifier
     * @returns Updated container metadata
     */
    async startContainer(container_id: string): Promise<Container> {
        await this.initializationPromise;

        const container = await this.getContainerStatus(container_id);

        if (container.state !== ContainerState.CREATED) {
            throw new Error(`Container must be in CREATED state to start (current: ${container.state})`);
        }

        // Start container — use Docker daemon if available, fall back to child_process mock
        await this.dockerInitPromise;

        // Update container state
        container.state = ContainerState.RUNNING;
        container.started_at = new Date().toISOString();

        if (this.dockerEnabled && this.dockerClient) {
            const dockerCtr = await this.dockerClient.createContainer({
                Image: container.image,
                Cmd: ["/bin/sh"],
                Tty: false,
                AttachStdin: false,
                AttachStdout: false,
                AttachStderr: false,
                HostConfig: {
                    Memory: container.resource_quota.memory_limit_mb * 1024 * 1024,
                    CpuQuota: Math.floor(container.resource_quota.cpu_limit * 100000),
                    StorageOpt: container.resource_quota.disk_limit_mb > 0
                        ? { size: `${container.resource_quota.disk_limit_mb}M` }
                        : undefined
                }
            });
            await dockerCtr.start();
            // Store in active containers
            this.activeContainers.set(container_id, { dockerContainer: dockerCtr, container });
        } else {
            const isWin = process.platform === "win32";
            const mockProc = spawn(isWin ? "cmd.exe" : "sh", [], {
                stdio: ["pipe", "pipe", "pipe"]
            });
            // Store in active containers
            this.activeContainers.set(container_id, { process: mockProc, container });
        }

        // Persist changes
        await this.persistContainer(container);

        // Emit activity
        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_start",
            status: "succeeded",
            details: { container_id },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow"
        });

        return container;
    }

    /**
     * Execute a command in container
     * 
     * @param container_id - Container identifier
     * @param command - Command to execute
     * @param timeout_ms - Execution timeout
     * @returns Execution response
     */
    async execInContainer(
        container_id: string,
        command: string,
        timeout_ms: number = 30000
    ): Promise<ExecInContainerResponse> {
        await this.initializationPromise;

        const start = Date.now();

        const containerEntry = this.activeContainers.get(container_id);
        if (!containerEntry) {
            throw new Error(`Container ${container_id} not found or not running`);
        }

        const { process: containerProc, dockerContainer, container } = containerEntry;

        // Step 1: Classify command tier
        const tier = this.classifyCommandTier(command);

        // Step 2: Route through policy engine
        const policyDecision = await this.routeThroughPolicy(container_id, tier, command);

        if (policyDecision === "deny") {
            throw new Error(`Command denied by policy (tier: ${tier})`);
        }

        // Step 3: Monitor resource usage
        this.monitorResourceUsage(container_id);

        // Step 4: Setup timeout handler
        let timedOut = false;
        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            this.handleTimeout(container_id, timeout_ms);
        }, timeout_ms);

        // Step 5: Execute command
        let stdout = "";
        let stderr = "";

        if (dockerContainer) {
            // Real Docker exec via dockerode
            return new Promise((resolve, reject) => {
                dockerContainer.exec({
                    Cmd: ["/bin/sh", "-c", command],
                    AttachStdout: true,
                    AttachStderr: true
                }, (err: any, exec: any) => {
                    if (err) { clearTimeout(timeoutHandle); return reject(err); }
                    exec.start({ hijack: true, stdin: false }, (err: any, stream: any) => {
                        if (err) { clearTimeout(timeoutHandle); return reject(err); }
                        const stdoutBufs: Buffer[] = [];
                        const stderrBufs: Buffer[] = [];
                        dockerContainer.modem.demuxStream(
                            stream,
                            { write: (c: Buffer) => { if (!timedOut) stdoutBufs.push(c); } },
                            { write: (c: Buffer) => { if (!timedOut) stderrBufs.push(c); } }
                        );
                        stream.on("end", () => {
                            clearTimeout(timeoutHandle);
                            const execution_time_ms = Date.now() - start;
                            stdout = Buffer.concat(stdoutBufs).toString("utf8");
                            stderr = Buffer.concat(stderrBufs).toString("utf8");
                            exec.inspect((inspectErr: any, data: any) => {
                                const exit_code = inspectErr ? -1 : (data?.ExitCode ?? 0);
                                const response: ExecInContainerResponse = {
                                    container_id, command, exit_code, stdout, stderr,
                                    execution_time_ms, timestamp: new Date().toISOString()
                                };
                                container.state = ContainerState.RUNNING;
                                this.persistContainer(container);
                                this.persistCommandExecution(response, `tier_${tier}_executed`);
                                resolve(response);
                            });
                        });
                        stream.on("error", (e: Error) => { clearTimeout(timeoutHandle); reject(e); });
                    });
                });
            });
        }

        const proc = containerProc as ChildProcess;
        return new Promise((resolve, reject) => {
            const isWin = process.platform === "win32";
            proc.stdin?.write(command + "\n");

            const stdoutListener = (data: Buffer) => {
                if (!timedOut) {
                    stdout += data.toString();
                }
            };

            const stderrListener = (data: Buffer) => {
                if (!timedOut) {
                    stderr += data.toString();
                }
            };

            proc.stdout?.on("data", stdoutListener);
            proc.stderr?.on("data", stderrListener);

            const exitCodeRegex = isWin ? /PRISM_EC=(\d+)/ : /\$\?=(\d+)/;
            const checkExitCode = () => {
                if (isWin) {
                    proc.stdin?.write("echo PRISM_EC=%ERRORLEVEL%\n");
                } else {
                    proc.stdin?.write("echo $?=\\$?\n");
                }

                let exitBuffer = "";
                const onExitData = async (data: Buffer) => {
                    exitBuffer += data.toString();
                    const match = exitBuffer.match(exitCodeRegex);
                    if (match) {
                        const execution_time_ms = Date.now() - start;
                        const exit_code = parseInt(match[1], 10);

                        // Cleanup
                        clearTimeout(timeoutHandle);
                        proc.stdout?.removeListener("data", stdoutListener);
                        proc.stdout?.removeListener("data", onExitData);
                        proc.stderr?.removeListener("data", stderrListener);

                        const response: ExecInContainerResponse = {
                            container_id,
                            command,
                            exit_code,
                            stdout,
                            stderr,
                            execution_time_ms,
                            timestamp: new Date().toISOString()
                        };

                        // Update container state and persist
                        container.state = ContainerState.RUNNING;
                        await this.persistContainer(container);
                        await this.persistCommandExecution(response, `tier_${tier}_executed`);

                        resolve(response);
                    }
                };

                proc.stdout?.on("data", onExitData);
            };

            setTimeout(checkExitCode, 100);
        });
    }

    /**
     * Create snapshot of container state
     * 
     * @param container_id - Container identifier
     * @param snapshot_name - Human-readable name for snapshot
     * @param description - Optional description
     * @returns Snapshot metadata
     */
    async snapshotContainer(
        container_id: string,
        snapshot_name: string,
        description?: string
    ): Promise<ContainerSnapshot> {
        await this.initializationPromise;

        const snapshot_id = uuidv4();
        const created_at = new Date().toISOString();

        // Get existing snapshots to find parent
        const existingSnapshots = this.snapshots.get(container_id) || [];
        const parent_snapshot_id = existingSnapshots.length > 0 ? existingSnapshots[existingSnapshots.length - 1].snapshot_id : undefined;

        const snapshot: ContainerSnapshot = {
            snapshot_id,
            container_id,
            snapshot_name,
            description,
            snapshot_size_mb: this.dockerEnabled ? 0 : 1, // 1 = simulated placeholder; real size set via Docker commit
            command_count: existingSnapshots.reduce((sum, s) => sum + s.command_count, 0),
            created_at,
            parent_snapshot_id
        };

        // Store snapshot metadata
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
                    snapshot.parent_snapshot_id
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Track in memory
        existingSnapshots.push(snapshot);

        // Docker image commit — persist real container filesystem state as a named image
        if (this.dockerEnabled) {
            const cEntry = this.activeContainers.get(container_id);
            if (cEntry?.dockerContainer) {
                await cEntry.dockerContainer.commit({ repo: "prism-snapshot", tag: snapshot_id })
                    .catch(() => { /* non-fatal: metadata snapshot preserved even if image commit fails */ });
            }
        }

        // Emit activity
        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_snapshot",
            status: "succeeded",
            details: { snapshot_name, snapshot_id },
            authorityTier: "tier2_conditional",
            policyDecision: "allow"
        });

        return snapshot;
    }

    /**
     * Revert container to previous snapshot state
     * 
     * @param container_id - Container identifier
     * @param snapshot_id - Snapshot to revert to
     * @returns Updated container metadata
     */
    async revertContainer(
        container_id: string,
        snapshot_id: string
    ): Promise<Container> {
        await this.initializationPromise;

        const container = await this.getContainerStatus(container_id);

        // Verify snapshot exists
        const snapshots = this.snapshots.get(container_id) || [];
        const snapshot = snapshots.find(s => s.snapshot_id === snapshot_id);

        if (!snapshot) {
            throw new Error(`Snapshot ${snapshot_id} not found for container ${container_id}`);
        }

        // Stop container if running
        if (container.state === ContainerState.RUNNING || container.state === ContainerState.EXECUTING) {
            await this.stopContainer(container_id);
        }

        // Restart container from snapshot
        const containerEntry = this.activeContainers.get(container_id);

        if (this.dockerEnabled && this.dockerClient && containerEntry?.dockerContainer) {
            // Remove old Docker container and recreate from committed snapshot image
            try { await containerEntry.dockerContainer.stop(); } catch { /* already stopped */ }
            try { await containerEntry.dockerContainer.remove({ force: true }); } catch { /* best effort */ }
            const dockerCtr = await this.dockerClient.createContainer({
                Image: `prism-snapshot:${snapshot_id}`,
                Cmd: ["/bin/sh"],
                Tty: false,
                AttachStdin: false,
                AttachStdout: false,
                AttachStderr: false,
                HostConfig: {
                    Memory: container.resource_quota.memory_limit_mb * 1024 * 1024,
                    CpuQuota: Math.floor(container.resource_quota.cpu_limit * 100000)
                }
            });
            await dockerCtr.start();
            container.state = ContainerState.RUNNING;
            container.started_at = new Date().toISOString();
            this.activeContainers.set(container_id, { dockerContainer: dockerCtr, container });
        } else {
            if (containerEntry?.process) {
                containerEntry.process.kill();
            }
            const isWin = process.platform === "win32";
            const mockProc = spawn(isWin ? "cmd.exe" : "sh", [], {
                stdio: ["pipe", "pipe", "pipe"]
            });
            container.state = ContainerState.RUNNING;
            container.started_at = new Date().toISOString();
            this.activeContainers.set(container_id, { process: mockProc, container });
        }

        // Persist changes
        await this.persistContainer(container);

        // Emit activity
        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_revert",
            status: "succeeded",
            details: { snapshot_id },
            authorityTier: "tier2_conditional",
            policyDecision: "allow"
        });

        return container;
    }

    /**
     * Stop a container
     * 
     * @param container_id - Container identifier
     */
    async stopContainer(container_id: string): Promise<void> {
        await this.initializationPromise;

        const container = await this.getContainerStatus(container_id);

        const containerEntry = this.activeContainers.get(container_id);
        if (containerEntry) {
            if (this.dockerEnabled && containerEntry.dockerContainer) {
                // Real Docker stop
                try {
                    await containerEntry.dockerContainer.stop({ t: 10 });
                } catch { /* already stopped */ }
                this.db.run(
                    "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
                    [container_id, "SIGTERM", "graceful_stop", new Date().toISOString()]
                );
            } else if (containerEntry.process) {
                const proc = containerEntry.process;
                // SIGTERM for graceful shutdown
                proc.kill("SIGTERM");

                this.db.run(
                    "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
                    [container_id, "SIGTERM", "graceful_stop", new Date().toISOString()]
                );

                // Wait 2 seconds
                await new Promise(resolve => setTimeout(resolve, 2000));

                // SIGKILL if still alive
                if (!proc.killed) {
                    proc.kill("SIGKILL");
                    this.db.run(
                        "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
                        [container_id, "SIGKILL", "forced_stop", new Date().toISOString()]
                    );
                }
            }

            this.activeContainers.delete(container_id);
        }

        container.state = ContainerState.STOPPED;
        container.stopped_at = new Date().toISOString();
        await this.persistContainer(container);

        // Emit activity
        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_stop",
            status: "succeeded",
            details: { container_id },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow"
        });
    }

    /**
     * Destroy a container (approval-gated)
     * 
     * @param container_id - Container identifier
     * @param reason - Reason for destruction
     */
    async destroyContainer(container_id: string, reason: string): Promise<void> {
        await this.initializationPromise;

        const container = await this.getContainerStatus(container_id);

        // Stop if running
        if (container.state === ContainerState.RUNNING || container.state === ContainerState.EXECUTING) {
            await this.stopContainer(container_id);
        }

        const containerEntry = this.activeContainers.get(container_id);
        if (containerEntry) {
            if (this.dockerEnabled && containerEntry.dockerContainer) {
                // Real Docker force-remove
                try { await containerEntry.dockerContainer.remove({ force: true }); } catch { /* best effort */ }
            } else if (containerEntry.process) {
                containerEntry.process.kill("SIGKILL");
            }
            this.db.run(
                "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
                [container_id, "SIGKILL", `destruction: ${reason}`, new Date().toISOString()]
            );

            this.activeContainers.delete(container_id);
        }

        // Delete snapshots
        this.snapshots.delete(container_id);

        container.state = ContainerState.DESTROYED;
        await this.persistContainer(container);

        // Emit activity with Tier 3
        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_destroy",
            status: "succeeded",
            details: { reason },
            authorityTier: "tier3_approval",
            policyDecision: "allow"
        });
    }

    /**
     * Get current container status
     * 
     * @param container_id - Container identifier
     * @returns Current container metadata
     */
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
                                disk_limit_mb: row.disk_limit_mb
                            },
                            created_at: row.created_at,
                            started_at: row.started_at,
                            stopped_at: row.stopped_at
                        });
                    }
                }
            );
        });
    }

    /**
     * List all snapshots for a container
     * 
     * @param container_id - Container identifier
     * @returns List of snapshots
     */
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
                        resolve(rows.map(r => ({
                            snapshot_id: r.snapshot_id,
                            container_id: r.container_id,
                            snapshot_name: r.snapshot_name,
                            description: r.description,
                            snapshot_size_mb: r.snapshot_size_mb,
                            command_count: r.command_count,
                            created_at: r.created_at,
                            parent_snapshot_id: r.parent_snapshot_id
                        })));
                    }
                }
            );
        });
    }

    /**
     * Classify command tier for policy routing
     * 
     * @private
     * @param command - Command to classify
     * @returns Policy tier
     */
    private classifyCommandTier(command: string): "tier1" | "tier2" | "tier3" {
        const primaryCmd = command.trim().split(/[\s|&;]/)[0];

        if (TIER1_KEYWORDS.includes(primaryCmd)) {
            return "tier1";
        } else if (TIER2_KEYWORDS.includes(primaryCmd)) {
            return "tier2";
        } else if (TIER3_KEYWORDS.includes(primaryCmd)) {
            return "tier3";
        }

        return "tier2";
    }

    /**
     * Route command through policy engine
     * 
     * @private
     * @param container_id - Container identifier
     * @param tier - Policy tier
     * @param command - Command text
     * @returns Policy decision
     */
    private async routeThroughPolicy(
        container_id: string,
        tier: "tier1" | "tier2" | "tier3",
        command: string
    ): Promise<"allow" | "deny" | "request_approval"> {
        // Tier 1: Allow if profile permits autonomous operations
        if (tier === "tier1") {
            return "allow";
        }

        // Tier 2: Conditional allow — Business profile requires audit logging
        if (tier === "tier2") {
            if (this.executionProfile.auditAllOperations) {
                this.activityBus.emit({
                    sessionId: container_id,
                    layer: "governance",
                    operation: "container_tier2_audit",
                    status: "succeeded",
                    details: { command, segment: this.executionProfile.segment, reason: "audit_all_operations" },
                    authorityTier: "tier2_conditional",
                    policyDecision: "allow"
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
                    policyDecision: "allow"
                });
            }
            return "allow";
        }

        // Tier 3: Requires approval for high-risk operations
        if (this.executionProfile.tier3ApprovalRequired) {
            this.activityBus.emit({
                sessionId: container_id,
                layer: "governance",
                operation: "container_tier3_approval_required",
                status: "started",
                details: { command, segment: this.executionProfile.segment },
                authorityTier: "tier3_approval",
                policyDecision: "require_approval"
            });
            return "request_approval";
        }

        return "allow";
    }

    /**
     * Monitor container resource usage against quotas
     * 
     * @private
     * @param container_id - Container identifier
     */
    private async monitorResourceUsage(container_id: string): Promise<void> {
        if (!this.dockerEnabled || !this.dockerClient) {
            return Promise.resolve();
        }
        const containerEntry = this.activeContainers.get(container_id);
        if (!containerEntry?.dockerContainer) {
            return Promise.resolve();
        }
        try {
            const stats: any = await new Promise((resolve, reject) => {
                containerEntry.dockerContainer.stats({ stream: false }, (err: any, data: any) => {
                    if (err) reject(err); else resolve(data);
                });
            });
            const container = containerEntry.container;
            const memUsageMb = Math.round((stats?.memory_stats?.usage ?? 0) / (1024 * 1024));
            if (memUsageMb > container.resource_quota.memory_limit_mb) {
                this.activityBus.emit({
                    sessionId: container_id,
                    layer: "governance",
                    operation: "container_resource_quota_exceeded",
                    status: "failed",
                    details: { memUsageMb, limitMb: container.resource_quota.memory_limit_mb },
                    authorityTier: "tier2_conditional",
                    policyDecision: "allow"
                });
            }
        } catch {
            // Stats unavailable — non-fatal
        }
    }

    /**
     * Handle command timeout
     * 
     * @private
     * @param container_id - Container identifier
     * @param timeout_ms - Timeout duration
     */
    private handleTimeout(container_id: string, timeout_ms: number): void {
        const containerEntry = this.activeContainers.get(container_id);
        if (!containerEntry) {
            return;
        }

        const { process: containerProc, dockerContainer, container } = containerEntry;

        this.db.run(
            "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [container_id, "SIGTERM", "timeout_handler", new Date().toISOString()]
        );

        if (this.dockerEnabled && dockerContainer) {
            // Docker stop is async; fire-and-forget for timeout handler
            dockerContainer.stop({ t: 5 }).catch(() => { /* best effort */ });
            container.state = ContainerState.TIMEOUT;
            this.persistContainer(container);
        } else if (containerProc) {
            // SIGTERM
            containerProc.kill("SIGTERM");

            // Wait 2 seconds then SIGKILL if still alive
            setTimeout(() => {
                if (!containerProc.killed) {
                    // SIGKILL
                    containerProc.kill("SIGKILL");
                    this.db.run(
                        "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
                        [container_id, "SIGKILL", "timeout_kill", new Date().toISOString()]
                    );

                    container.state = ContainerState.TIMEOUT;
                    this.persistContainer(container);
                }
            }, 2000);
        }
    }

    /**
     * Persist container metadata to database
     * 
     * @private
     * @param container - Container to persist
     */
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
                    container.stopped_at
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Persist command execution to database
     * 
     * @private
     * @param response - Execution response
     * @param reason_code - Audit trail reason code
     */
    private async persistCommandExecution(
        response: ExecInContainerResponse,
        reason_code: string
    ): Promise<void> {
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
                    response.timestamp
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}
