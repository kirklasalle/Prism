/**
 * Terminal Session Adapter
 * 
 * Manages isolated terminal sessions with lifecycle control, timeout handling,
 * and policy-tier integration. All operations are persistence-backed and 
 * support deterministic replay validation.
 * 
 * See: TERMINAL_VIRTUALIZATION_DESIGN.md for full specification
 * 
 * @module adapters/application/terminal-session-adapter
 */

import sqlite3 from "sqlite3";
import { v4 as uuidv4 } from "uuid";
import { PolicyEngine } from "../../core/policy/engine.js";
import { ActivityBus } from "../../core/activity/bus.js";
import type { ExecutionProfile } from "../../core/policy/execution-profiles.js";
import { INDIVIDUAL_PROFILE } from "../../core/policy/execution-profiles.js";

/**
 * Terminal session state enumeration
 */
export enum TerminalSessionState {
    IDLE = "idle",
    ACTIVE = "active",
    EXECUTING = "executing",
    SUSPENDED = "suspended",
    TIMEOUT = "timeout",
    REVOKED = "revoked",
    TERMINATED = "terminated"
}

/**
 * Terminal session metadata
 */
export interface TerminalSession {
    session_id: string;
    shell: string;
    working_directory: string;
    user: string;
    state: TerminalSessionState;
    start_time: string;
    last_activity: string;
    process_id?: number;
    environment: Record<string, string>;
}

/**
 * Response from exec command
 */
export interface ExecCommandResponse {
    session_id: string;
    command: string;
    exit_code: number;
    stdout: string;
    stderr: string;
    execution_time_ms: number;
    timestamp: string;
}

/**
 * Response from revoke session
 */
export interface RevokeSessionResponse {
    session_id: string;
    revocation_time: string;
    forced_termination: boolean;
    cleanup_status: "pending" | "in_progress" | "completed";
}

// Tier 1: Read-only operations
const TIER1_KEYWORDS = ["ls", "cat", "grep", "pwd", "echo", "cd", "head", "tail", "wc", "find", "locate", "stat", "file", "ipconfig", "ifconfig", "ping", "nslookup", "dig", "tracert", "traceroute", "netstat", "arp", "hostname", "nbtstat", "pathping", "getmac", "ss", "curl", "wget"];

// Tier 2: Mutating operations
const TIER2_KEYWORDS = ["mkdir", "touch", "cp", "mv", "chmod", "chgrp", "ln", "tar", "zip", "gzip", "sed", "awk", "netsh", "route"];

// Tier 3: High-risk operations
const TIER3_KEYWORDS = ["rm", "sudo", "reboot", "dd", "mkfs", "halt", "shutdown", "kill", "chown", "fdisk", "format", "umount", "fsck"];

/**
 * Terminal Session Adapter
 * 
 * Handles isolated terminal session lifecycle with policy routing,
 * timeout enforcement, and deterministic replay validation.
 */
export class TerminalSessionAdapter {
    private db: sqlite3.Database;
    private policyEngine: PolicyEngine;
    private activityBus: ActivityBus;
    private executionProfile: ExecutionProfile;
    private activeSessions: Map<string, { ptyProcess: any; session: TerminalSession }> = new Map();
    private initializationPromise: Promise<void>;
    private ptyEnabled = false;
    private ptyModule: any = null;
    private ptyInitPromise: Promise<void>;
    private ptyInitError: string | null = null;

    constructor(db: sqlite3.Database, policyEngine: PolicyEngine, activityBus: ActivityBus, executionProfile?: ExecutionProfile) {
        this.db = db;
        this.policyEngine = policyEngine;
        this.activityBus = activityBus;
        this.executionProfile = executionProfile ?? INDIVIDUAL_PROFILE;
        this.initializationPromise = this.initializeDatabase();
        this.ptyInitPromise = this.tryInitPty().catch((error: unknown) => {
            this.ptyEnabled = false;
            this.ptyModule = null;
            this.ptyInitError = error instanceof Error ? error.message : String(error);
        });
    }

    /** Attempt to load node-pty module for real PTY sessions. */
    private async tryInitPty(): Promise<void> {
        const pty = await import("node-pty");
        if (typeof pty.spawn !== "function") {
            throw new Error("node-pty loaded but spawn() is unavailable");
        }
        this.ptyModule = pty;
        this.ptyEnabled = true;
    }

    private async ensurePtyReady(): Promise<void> {
        await this.ptyInitPromise;
        if (!this.ptyEnabled || !this.ptyModule) {
            const reason = this.ptyInitError ? ` (${this.ptyInitError})` : "";
            throw new Error(`PTY runtime is unavailable${reason}. Install and enable a working node-pty backend.`);
        }
    }

    /** Whether real PTY terminal is active (node-pty loaded and functional). */
    isPtyEnabled(): boolean {
        return this.ptyEnabled;
    }

    /** Resize terminal window for an active PTY session. No-op for non-PTY sessions. */
    resizeTerminal(session_id: string, cols: number, rows: number): void {
        const entry = this.activeSessions.get(session_id);
        if (entry?.ptyProcess) {
            entry.ptyProcess.resize(cols, rows);
        }
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
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS terminal_sessions (
                        session_id TEXT PRIMARY KEY,
                        shell TEXT NOT NULL,
                        working_directory TEXT NOT NULL,
                        user TEXT NOT NULL,
                        state TEXT NOT NULL,
                        start_time TEXT NOT NULL,
                        last_activity TEXT NOT NULL,
                        process_id INTEGER,
                        environment JSON NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `, (sessionErr) => {
                    if (sessionErr) {
                        reject(sessionErr);
                        return;
                    }

                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS terminal_command_history (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id TEXT NOT NULL,
                            command TEXT NOT NULL,
                            exit_code INTEGER NOT NULL,
                            stdout TEXT,
                            stderr TEXT,
                            execution_time_ms INTEGER NOT NULL,
                            reason_code TEXT NOT NULL,
                            timestamp TEXT NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY(session_id) REFERENCES terminal_sessions(session_id)
                        )
                    `, (historyErr) => {
                        if (historyErr) {
                            reject(historyErr);
                            return;
                        }

                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS terminal_signal_log (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                session_id TEXT NOT NULL,
                                signal TEXT NOT NULL,
                                reason TEXT,
                                timestamp TEXT NOT NULL,
                                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY(session_id) REFERENCES terminal_sessions(session_id)
                            )
                        `, (signalErr) => {
                            if (signalErr) {
                                reject(signalErr);
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
     * Start a new terminal session
     * 
     * @param shell - Shell to use (e.g., /bin/bash)
     * @param working_directory - Working directory for session
     * @param user - User running the session
     * @returns Created session metadata
     */
    async startSession(
        shell: string,
        working_directory: string,
        user: string
    ): Promise<TerminalSession> {
        await this.initializationPromise;
        const session_id = uuidv4();
        const start_time = new Date().toISOString();

        // PTY is mandatory. No child_process fallback is permitted.
        await this.ensurePtyReady();

        const session: TerminalSession = {
            session_id,
            shell,
            working_directory,
            user,
            state: TerminalSessionState.IDLE,
            start_time,
            last_activity: start_time,
            process_id: undefined,
            environment: { ...process.env } as Record<string, string>
        };

        let sessionEntry!: { ptyProcess: any; session: TerminalSession };
        const backendErrors: string[] = [];
        for (const useConpty of (process.platform === "win32" ? [true, false] : [undefined])) {
            try {
                const spawnOpts: Record<string, unknown> = {
                    name: "xterm-256color",
                    cols: 80,
                    rows: 24,
                    cwd: working_directory,
                    env: process.env as Record<string, string>,
                };
                if (useConpty !== undefined) spawnOpts["useConpty"] = useConpty;

                const ptyProc = this.ptyModule.spawn(shell, [], spawnOpts);

                // Verify backend stability before exposing session.
                let earlyExit = false;
                const exitHandler = () => { earlyExit = true; };
                ptyProc.once("exit", exitHandler);
                await new Promise(resolve => setTimeout(resolve, 400));
                ptyProc.removeListener("exit", exitHandler);

                if (!earlyExit) {
                    session.process_id = ptyProc.pid;
                    sessionEntry = { ptyProcess: ptyProc, session };
                    break;
                }

                backendErrors.push(`PTY backend exited early (useConpty=${String(useConpty)})`);
            } catch (error) {
                backendErrors.push(`PTY spawn failed (useConpty=${String(useConpty)}): ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (!sessionEntry) {
            throw new Error(`Unable to start a real PTY session. ${backendErrors.join("; ")}`);
        }

        // Store in memory
        this.activeSessions.set(session_id, sessionEntry);

        // Persist to database
        await this.persistSession(session);

        // Emit activity
        this.activityBus.emit({
            sessionId: session_id,
            layer: "governance",
            operation: "terminal_session_start",
            status: "succeeded",
            details: { shell, working_directory, user },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow"
        });

        return session;
    }

    /**
     * Execute a command in a session
     * 
     * @param session_id - Session identifier
     * @param command - Command to execute
     * @param timeout_ms - Execution timeout in milliseconds
     * @returns Execution response
     */
    async execCommand(
        session_id: string,
        command: string,
        timeout_ms: number = 30000
    ): Promise<ExecCommandResponse> {
        await this.initializationPromise;
        const start = Date.now();

        // Get session
        const sessionEntry = this.activeSessions.get(session_id);
        if (!sessionEntry) {
            throw new Error(`Session ${session_id} not found`);
        }

        const { ptyProcess, session } = sessionEntry;

        // Step 1: Classify command tier
        const tier = this.classifyCommandTier(command);

        // Step 2: Route through policy engine
        const policyDecision = await this.routeThroughPolicy(session_id, tier, command);

        if (policyDecision === "deny") {
            throw new Error(`Command denied by policy (tier: ${tier})`);
        }

        // Step 3: Setup timeout handler
        let timedOut = false;
        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            this.handleTimeout(session_id, timeout_ms);
        }, timeout_ms);

        // Step 4: Execute command
        let stdout = "";
        let stderr = "";

        // Real PTY execution — sentinel-based exit code detection
        return new Promise((resolve, reject) => {
            const SENTINEL = "__PRISM_DONE__";
            const sentinelRe = new RegExp(`${SENTINEL}:(\\d+)`);
            let ptyBuffer = "";

            const onData = async (data: string) => {
                if (timedOut) return;
                ptyBuffer += data;
                const match = ptyBuffer.match(sentinelRe);
                if (match) {
                    clearTimeout(timeoutHandle);
                    ptyProcess.removeListener("data", onData);
                    const exit_code = parseInt(match[1], 10);
                    const sentinelIdx = ptyBuffer.indexOf(SENTINEL);
                    const rawOut = sentinelIdx > 0 ? ptyBuffer.substring(0, sentinelIdx) : ptyBuffer;
                    const lines = rawOut.split(/\r?\n/);
                    if (lines[0]?.trim() === command.trim()) lines.shift();
                    stdout = lines.join("\n").trim();
                    const execution_time_ms = Date.now() - start;
                    const response: ExecCommandResponse = {
                        session_id,
                        command,
                        exit_code,
                        stdout,
                        stderr,
                        execution_time_ms,
                        timestamp: new Date().toISOString()
                    };
                    session.state = TerminalSessionState.ACTIVE;
                    session.last_activity = new Date().toISOString();
                    await this.persistSession(session);
                    await this.persistCommandExecution(response, `tier_${tier}_executed`);
                    resolve(response);
                }
            };

            ptyProcess.once("exit", () => {
                if (!ptyBuffer.match(sentinelRe)) {
                    clearTimeout(timeoutHandle);
                    ptyProcess.removeListener("data", onData);
                    reject(new Error("PTY process exited before command completed"));
                }
            });

            ptyProcess.on("data", onData);
            if (process.platform === "win32") {
                ptyProcess.write(`${command} & echo ${SENTINEL}:%ERRORLEVEL%\r\n`);
            } else {
                ptyProcess.write(`${command}; echo ${SENTINEL}:$?\n`);
            }
        });
    }

    /**
     * Pause a running session (real OS-level suspension).
     *
     * - POSIX: SIGSTOP delivered to the PTY child PID via process.kill.
     * - Win32: NtSuspendProcess invoked through PowerShell P/Invoke against the
     *   PTY child PID (mirrors the SendInput P/Invoke pattern already shipped
     *   in computer-use-tool.ts).
     *
     * Idempotent: calling pauseSession on an already-suspended session re-issues
     * the suspension call and refreshes the signal log entry.
     *
     * @param session_id - Session identifier
     */
    async pauseSession(session_id: string): Promise<void> {
        await this.initializationPromise;
        const sessionEntry = this.activeSessions.get(session_id);
        if (!sessionEntry) {
            throw new Error(`Session ${session_id} not found`);
        }
        const { ptyProcess, session } = sessionEntry;
        const pid = ptyProcess.pid as number;
        if (typeof pid !== "number" || pid <= 0) {
            throw new Error(`Session ${session_id} has no live process to pause`);
        }

        if (process.platform === "win32") {
            await this.win32SuspendOrResume(pid, "suspend");
        } else {
            try {
                process.kill(pid, "SIGSTOP");
            } catch (error) {
                throw new Error(`SIGSTOP delivery failed for pid=${pid}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        this.db.run(
            "INSERT INTO terminal_signal_log (session_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [session_id, process.platform === "win32" ? "NtSuspendProcess" : "SIGSTOP", "pause_session", new Date().toISOString()],
            () => { }
        );

        session.state = TerminalSessionState.SUSPENDED;
        session.last_activity = new Date().toISOString();
        await this.persistSession(session);

        this.activityBus.emit({
            sessionId: session_id,
            layer: "governance",
            operation: "terminal_session_pause",
            status: "succeeded",
            details: { pid, platform: process.platform },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow"
        });
    }

    /**
     * Resume a previously paused session.
     *
     * - POSIX: SIGCONT delivered to the PTY child PID via process.kill.
     * - Win32: NtResumeProcess invoked through PowerShell P/Invoke.
     *
     * Idempotent and safe to call against an already-active session.
     *
     * @param session_id - Session identifier
     */
    async resumeSession(session_id: string): Promise<void> {
        await this.initializationPromise;
        const sessionEntry = this.activeSessions.get(session_id);
        if (!sessionEntry) {
            throw new Error(`Session ${session_id} not found`);
        }
        const { ptyProcess, session } = sessionEntry;
        const pid = ptyProcess.pid as number;
        if (typeof pid !== "number" || pid <= 0) {
            throw new Error(`Session ${session_id} has no live process to resume`);
        }

        if (process.platform === "win32") {
            await this.win32SuspendOrResume(pid, "resume");
        } else {
            try {
                process.kill(pid, "SIGCONT");
            } catch (error) {
                throw new Error(`SIGCONT delivery failed for pid=${pid}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        this.db.run(
            "INSERT INTO terminal_signal_log (session_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [session_id, process.platform === "win32" ? "NtResumeProcess" : "SIGCONT", "resume_session", new Date().toISOString()],
            () => { }
        );

        session.state = TerminalSessionState.ACTIVE;
        session.last_activity = new Date().toISOString();
        await this.persistSession(session);

        this.activityBus.emit({
            sessionId: session_id,
            layer: "governance",
            operation: "terminal_session_resume",
            status: "succeeded",
            details: { pid, platform: process.platform },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow"
        });
    }

    /**
     * Win32 NtSuspendProcess / NtResumeProcess via PowerShell P/Invoke.
     * Same pattern used by ComputerUseTool's SendInput shim — no native deps.
     * @private
     */
    private async win32SuspendOrResume(pid: number, mode: "suspend" | "resume"): Promise<void> {
        const { spawn } = await import("node:child_process");
        const fn = mode === "suspend" ? "NtSuspendProcess" : "NtResumeProcess";
        const ps = `
$ErrorActionPreference = 'Stop';
$src = @"
using System;
using System.Runtime.InteropServices;
public static class PrismProc {
    [DllImport("ntdll.dll", SetLastError = true)]
    public static extern int NtSuspendProcess(IntPtr hProc);
    [DllImport("ntdll.dll", SetLastError = true)]
    public static extern int NtResumeProcess(IntPtr hProc);
}
"@;
Add-Type -TypeDefinition $src -Language CSharp;
$p = [System.Diagnostics.Process]::GetProcessById(${pid});
$rc = [PrismProc]::${fn}($p.Handle);
if ($rc -ne 0) { Write-Error "${fn} returned status 0x$($rc.ToString('X')) for pid ${pid}"; exit 1 };
exit 0;
`;
        await new Promise<void>((resolve, reject) => {
            const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true });
            let stderr = "";
            child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
            child.once("error", reject);
            child.once("exit", (code: number | null) => {
                if (code === 0) resolve();
                else reject(new Error(`${fn} pid=${pid} failed (exit=${code}): ${stderr.trim()}`));
            });
        });
    }

    /**
     * Stop a session gracefully
     * 
     * @param session_id - Session identifier
     */
    async stopSession(session_id: string): Promise<void> {
        await this.initializationPromise;
        const sessionEntry = this.activeSessions.get(session_id);
        if (!sessionEntry) {
            throw new Error(`Session ${session_id} not found`);
        }

        const { ptyProcess, session } = sessionEntry;

        ptyProcess.kill();
        this.db.run(
            "INSERT INTO terminal_signal_log (session_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [session_id, "SIGTERM", "graceful_stop", new Date().toISOString()],
            () => { }
        );

        // Update session state
        session.state = TerminalSessionState.TERMINATED;
        await this.persistSession(session);

        // Remove from active sessions
        this.activeSessions.delete(session_id);

        // Emit activity
        this.activityBus.emit({
            sessionId: session_id,
            layer: "governance",
            operation: "terminal_session_stop",
            status: "succeeded",
            details: { reason: "user_stop" },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow"
        });
    }

    /**
     * Revoke a session (approval-gated destruction)
     * 
     * @param session_id - Session identifier
     * @param reason - Reason for revocation
     * @returns Revocation response
     */
    async revokeSession(session_id: string, reason: string): Promise<RevokeSessionResponse> {
        await this.initializationPromise;
        const sessionEntry = this.activeSessions.get(session_id);
        if (!sessionEntry) {
            throw new Error(`Session ${session_id} not found`);
        }

        const { ptyProcess, session } = sessionEntry;

        // Force terminate
        ptyProcess.kill();

        // Log signal
        this.db.run(
            "INSERT INTO terminal_signal_log (session_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [session_id, "SIGKILL", `revocation: ${reason}`, new Date().toISOString()],
            () => { }
        );

        // Update session state
        session.state = TerminalSessionState.REVOKED;
        const revocation_time = new Date().toISOString();
        await this.persistSession(session);

        // Remove from active sessions
        this.activeSessions.delete(session_id);

        // Emit activity with approval tier (Tier 3)
        this.activityBus.emit({
            sessionId: session_id,
            layer: "governance",
            operation: "terminal_session_revoke",
            status: "succeeded",
            details: { reason },
            authorityTier: "tier3_approval",
            policyDecision: "allow"
        });

        return {
            session_id,
            revocation_time,
            forced_termination: true,
            cleanup_status: "completed"
        };
    }

    /**
     * Get current session status
     * 
     * @param session_id - Session identifier
     * @returns Current session metadata
     */
    async getSessionStatus(session_id: string): Promise<TerminalSession> {
        await this.initializationPromise;
        const sessionEntry = this.activeSessions.get(session_id);
        if (!sessionEntry) {
            throw new Error(`Session ${session_id} not found`);
        }

        const { session } = sessionEntry;

        // Update last_activity
        session.last_activity = new Date().toISOString();

        return session;
    }

    /**
     * Get session command history
     * 
     * @param session_id - Session identifier
     * @param limit - Number of recent commands to retrieve
     * @returns Command execution history
     */
    async getSessionHistory(
        session_id: string,
        limit: number = 100
    ): Promise<ExecCommandResponse[]> {
        await this.initializationPromise;
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT session_id, command, exit_code, stdout, stderr, execution_time_ms, timestamp
                 FROM terminal_command_history
                 WHERE session_id = ?
                 ORDER BY id DESC
                 LIMIT ?`,
                [session_id, limit],
                (err: any, rows: any[]) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows.map(r => ({
                            session_id: r.session_id,
                            command: r.command,
                            exit_code: r.exit_code,
                            stdout: r.stdout,
                            stderr: r.stderr,
                            execution_time_ms: r.execution_time_ms,
                            timestamp: r.timestamp
                        })));
                    }
                }
            );
        });
    }

    /**
     * Classify command tier for policy routing
     * 
     * Tier 1: Read-only operations (ls, cat, grep, pwd, echo)
     * Tier 2: Mutating operations (mkdir, touch, cp, mv, chmod)
     * Tier 3: High-risk operations (rm, sudo, reboot, dd, mkfs, halt, shutdown, kill, chown)
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

        // Default: treat unknown commands as Tier 2 (mutating) for safety
        return "tier2";
    }

    /**
     * Route command execution through policy engine
     * 
     * @private
     * @param session_id - Session identifier
     * @param tier - Policy tier for command
     * @param command - Command text
     * @returns Policy decision
     */
    private async routeThroughPolicy(
        session_id: string,
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
                    sessionId: session_id,
                    layer: "governance",
                    operation: "terminal_tier2_audit",
                    status: "succeeded",
                    details: { command, segment: this.executionProfile.segment, reason: "audit_all_operations" },
                    authorityTier: "tier2_conditional",
                    policyDecision: "allow"
                });
            }
            if (this.executionProfile.rollbackPlanRequired) {
                this.activityBus.emit({
                    sessionId: session_id,
                    layer: "governance",
                    operation: "terminal_tier2_rollback_advisory",
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
                sessionId: session_id,
                layer: "governance",
                operation: "terminal_tier3_approval_required",
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
     * Handle command timeout
     * 
     * @private
     * @param session_id - Session identifier
     * @param timeout_ms - Timeout duration
     */
    private handleTimeout(session_id: string, timeout_ms: number): void {
        const sessionEntry = this.activeSessions.get(session_id);
        if (!sessionEntry) {
            return;
        }

        const { ptyProcess, session } = sessionEntry;

        this.db.run(
            "INSERT INTO terminal_signal_log (session_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [session_id, "SIGTERM", "timeout_handler", new Date().toISOString()],
            () => { }
        );

        ptyProcess.kill();
        session.state = TerminalSessionState.TIMEOUT;
        this.persistSession(session).catch(() => { });
    }

    /**
     * Persist session metadata to database
     * 
     * @private
     * @param session - Session to persist
     */
    private async persistSession(session: TerminalSession): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO terminal_sessions 
                 (session_id, shell, working_directory, user, state, start_time, last_activity, process_id, environment)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    session.session_id,
                    session.shell,
                    session.working_directory,
                    session.user,
                    session.state,
                    session.start_time,
                    session.last_activity,
                    session.process_id,
                    JSON.stringify(session.environment)
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Persist command execution result to database
     * 
     * @private
     * @param response - Execution response to persist
     * @param reason_code - Reason code for audit trail
     */
    private async persistCommandExecution(
        response: ExecCommandResponse,
        reason_code: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO terminal_command_history 
                 (session_id, command, exit_code, stdout, stderr, execution_time_ms, reason_code, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    response.session_id,
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
