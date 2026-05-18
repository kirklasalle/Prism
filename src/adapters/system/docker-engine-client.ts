/**
 * Docker Engine API Client (direct, dependency-free)
 *
 * Speaks the Docker Engine API v1.43+ over the local UNIX socket
 * (POSIX) or named pipe (Win32) using only `node:http`. Intentionally avoids
 * the `dockerode` package so PRISM keeps its zero-new-runtime-deps invariant
 * (mirrors the W1–W7 / SendInput / NtSuspendProcess pattern: no FFI, no
 * native modules added at this layer).
 *
 * Scope (Phase R+ v0.18, slice 1): the lifecycle primitives required by the
 * Docker container adapter and PTAC s27 — ping, image pull, container create
 * + start + exec + wait + stop + commit + remove. NOT a general-purpose
 * Docker SDK; expand as PTAC scenarios demand.
 *
 * Backend probe order (when no `PRISM_DOCKER_HOST` is set):
 *  - Linux/macOS: `/var/run/docker.sock`
 *  - Win32:       `\\.\pipe\docker_engine`
 *
 * @module adapters/system/docker-engine-client
 */

import http from "node:http";
import { Buffer } from "node:buffer";

/** Default Engine API version pinned for stability. */
const ENGINE_API_VERSION = "v1.43";

/** Default UNIX socket on POSIX. */
export const DEFAULT_POSIX_SOCKET = "/var/run/docker.sock";
/** Default named pipe on Win32. */
export const DEFAULT_WIN32_PIPE = "\\\\.\\pipe\\docker_engine";

/** Docker Engine `HostConfig` subset used by PRISM. */
export interface DockerHostConfig {
    /** Bytes. Maps to `--memory`. */
    Memory?: number;
    /** Bytes. Maps to `--memory-swap`. -1 disables swap. */
    MemorySwap?: number;
    /** Nano-CPUs (1e9 = 1 CPU). Maps to `--cpus`. */
    NanoCpus?: number;
    /** Maps to `--pids-limit`. */
    PidsLimit?: number;
    /** Read-only root filesystem. Maps to `--read-only`. */
    ReadonlyRootfs?: boolean;
    /** Network mode. PRISM Business profile defaults to `"none"`. */
    NetworkMode?: "none" | "bridge" | "host" | string;
    /** Auto-remove on exit. */
    AutoRemove?: boolean;
    /** Bind mounts. Each "src:dst[:ro]". */
    Binds?: string[];
    /** Force container removal regardless. */
    [k: string]: unknown;
}

/** Body for POST /containers/create. */
export interface DockerCreateContainerBody {
    Image: string;
    Cmd?: string[];
    Entrypoint?: string[];
    WorkingDir?: string;
    Env?: string[];
    Tty?: boolean;
    AttachStdout?: boolean;
    AttachStderr?: boolean;
    HostConfig?: DockerHostConfig;
    Labels?: Record<string, string>;
    [k: string]: unknown;
}

/** Result of a non-streaming Engine API call. */
interface RawResponse {
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

/** Configuration for the Engine API client. */
export interface DockerEngineClientOptions {
    /** Override the default backend probe. Accepts an absolute socket path
     *  (POSIX) or a `\\.\pipe\xxx` pipe name (Win32). */
    socketPath?: string;
    /** Override the pinned Engine API version (`v1.43`). */
    apiVersion?: string;
    /** Default request timeout in milliseconds. */
    requestTimeoutMs?: number;
}

/**
 * Decode a multiplexed Docker stream frame buffer
 * (header: [stream-type:1][0:3][size:4-be], body follows). Returns merged
 * stdout/stderr text. Used by `containerWaitForExit` and `execStart`.
 */
export function decodeMultiplexedStream(buf: Buffer): { stdout: string; stderr: string } {
    let stdout = "";
    let stderr = "";
    let offset = 0;
    while (offset + 8 <= buf.length) {
        const streamType = buf.readUInt8(offset);
        const size = buf.readUInt32BE(offset + 4);
        const payloadStart = offset + 8;
        const payloadEnd = payloadStart + size;
        if (payloadEnd > buf.length) break;
        const chunk = buf.slice(payloadStart, payloadEnd).toString("utf8");
        if (streamType === 1) stdout += chunk;
        else if (streamType === 2) stderr += chunk;
        // streamType 0 (stdin) is not emitted by Docker; ignore.
        offset = payloadEnd;
    }
    return { stdout, stderr };
}

/**
 * Direct HTTP-over-socket client for the Docker Engine API. All methods
 * throw a `DockerEngineError` on a non-2xx response with the parsed
 * `{ message }` body when present.
 */
export class DockerEngineClient {
    private readonly socketPath: string;
    private readonly apiVersion: string;
    private readonly requestTimeoutMs: number;

    constructor(options: DockerEngineClientOptions = {}) {
        const env = process.env.PRISM_DOCKER_HOST ?? process.env.DOCKER_HOST;
        const fromEnv = (env && env.startsWith("unix://")) ? env.slice("unix://".length) : (env && env.startsWith("npipe://")) ? env.slice("npipe://".length) : undefined;
        this.socketPath = options.socketPath
            ?? fromEnv
            ?? (process.platform === "win32" ? DEFAULT_WIN32_PIPE : DEFAULT_POSIX_SOCKET);
        this.apiVersion = options.apiVersion ?? ENGINE_API_VERSION;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    }

    /** Resolved socket path the client is bound to. */
    getSocketPath(): string {
        return this.socketPath;
    }

    /**
     * GET /_ping — verify the Engine API is reachable and ready.
     * Returns true on HTTP 200 ("OK"); false otherwise.
     */
    async ping(): Promise<boolean> {
        try {
            const res = await this.requestRaw("GET", `/${this.apiVersion}/_ping`, undefined, undefined, 5_000);
            return res.statusCode === 200;
        } catch {
            return false;
        }
    }

    /**
     * POST /images/create?fromImage=<image>&tag=<tag>
     * Streams JSON progress; this method drains the stream and returns once
     * the pull terminates. Throws on the first JSON object containing an
     * `error` key.
     */
    async imagePull(image: string): Promise<void> {
        const [name, tag = "latest"] = image.includes(":") ? image.split(":", 2) : [image];
        const path = `/${this.apiVersion}/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`;
        const res = await this.requestRaw("POST", path, undefined, { "Content-Type": "application/json" }, 600_000);
        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new DockerEngineError(`imagePull(${image}) failed: ${res.statusCode}`, res.statusCode, res.body.toString("utf8"));
        }
        // Body is newline-delimited JSON progress events.
        for (const line of res.body.toString("utf8").split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const evt = JSON.parse(trimmed) as { error?: string };
                if (evt.error) throw new DockerEngineError(`imagePull(${image}) error event: ${evt.error}`, 500, trimmed);
            } catch (parseErr) {
                if (parseErr instanceof DockerEngineError) throw parseErr;
                // Tolerate malformed progress lines.
            }
        }
    }

    /**
     * POST /containers/create?name=<name>
     * @returns container Id assigned by the engine.
     */
    async containerCreate(body: DockerCreateContainerBody, name?: string): Promise<string> {
        const path = `/${this.apiVersion}/containers/create${name ? `?name=${encodeURIComponent(name)}` : ""}`;
        const res = await this.requestJson<{ Id: string }>("POST", path, body, 30_000);
        return res.Id;
    }

    /** POST /containers/{id}/start */
    async containerStart(id: string): Promise<void> {
        const res = await this.requestRaw("POST", `/${this.apiVersion}/containers/${id}/start`, undefined, undefined, 30_000);
        // 204 = started, 304 = already started (treat as success).
        if (res.statusCode !== 204 && res.statusCode !== 304) {
            throw new DockerEngineError(`containerStart(${id}) failed: ${res.statusCode}`, res.statusCode, res.body.toString("utf8"));
        }
    }

    /**
     * POST /containers/{id}/exec  +  POST /exec/{id}/start
     * Runs `cmd` inside `id`, returns merged stdout/stderr and exit code.
     * Uses `Tty:false` + multiplexed framing.
     */
    async containerExec(id: string, cmd: string[], opts: { workingDir?: string; env?: string[]; timeoutMs?: number } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        const createBody: Record<string, unknown> = {
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
            Cmd: cmd,
        };
        if (opts.workingDir) createBody.WorkingDir = opts.workingDir;
        if (opts.env && opts.env.length) createBody.Env = opts.env;

        const exec = await this.requestJson<{ Id: string }>("POST", `/${this.apiVersion}/containers/${id}/exec`, createBody, 30_000);
        const startRes = await this.requestRaw(
            "POST",
            `/${this.apiVersion}/exec/${exec.Id}/start`,
            Buffer.from(JSON.stringify({ Detach: false, Tty: false })),
            { "Content-Type": "application/json" },
            opts.timeoutMs ?? 60_000,
        );
        if (startRes.statusCode < 200 || startRes.statusCode >= 300) {
            throw new DockerEngineError(`exec start failed: ${startRes.statusCode}`, startRes.statusCode, startRes.body.toString("utf8"));
        }

        const { stdout, stderr } = decodeMultiplexedStream(startRes.body);

        // GET /exec/{id}/json → ExitCode (may briefly be null while finalizing).
        let exitCode = -1;
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
            const inspect = await this.requestJson<{ ExitCode: number | null; Running: boolean }>("GET", `/${this.apiVersion}/exec/${exec.Id}/json`, undefined, 5_000);
            if (!inspect.Running && inspect.ExitCode !== null) { exitCode = inspect.ExitCode; break; }
            await new Promise(r => setTimeout(r, 100));
        }
        return { exitCode, stdout, stderr };
    }

    /**
     * POST /containers/{id}/stop?t=<seconds>
     * Sends SIGTERM, waits up to `graceSeconds`, then SIGKILL.
     */
    async containerStop(id: string, graceSeconds = 10): Promise<void> {
        const path = `/${this.apiVersion}/containers/${id}/stop?t=${graceSeconds}`;
        const res = await this.requestRaw("POST", path, undefined, undefined, (graceSeconds + 5) * 1000);
        if (res.statusCode !== 204 && res.statusCode !== 304) {
            throw new DockerEngineError(`containerStop(${id}) failed: ${res.statusCode}`, res.statusCode, res.body.toString("utf8"));
        }
    }

    /**
     * POST /commit?container=<id>&repo=<repo>&tag=<tag>
     * Commits a running or stopped container into a new image. Used to
     * implement PRISM container snapshots.
     * @returns the new image Id (sha256:...).
     */
    async containerCommit(id: string, repo: string, tag: string, comment?: string): Promise<string> {
        const params = new URLSearchParams({ container: id, repo, tag });
        if (comment) params.set("comment", comment);
        const path = `/${this.apiVersion}/commit?${params.toString()}`;
        const res = await this.requestJson<{ Id: string }>("POST", path, {}, 60_000);
        return res.Id;
    }

    /** DELETE /containers/{id}?force=1&v=1 */
    async containerRemove(id: string, opts: { force?: boolean; removeVolumes?: boolean } = {}): Promise<void> {
        const params = new URLSearchParams();
        if (opts.force) params.set("force", "1");
        if (opts.removeVolumes) params.set("v", "1");
        const path = `/${this.apiVersion}/containers/${id}${params.toString() ? `?${params.toString()}` : ""}`;
        const res = await this.requestRaw("DELETE", path, undefined, undefined, 30_000);
        if (res.statusCode !== 204) {
            throw new DockerEngineError(`containerRemove(${id}) failed: ${res.statusCode}`, res.statusCode, res.body.toString("utf8"));
        }
    }

    /** DELETE /images/{name}?force=1 */
    async imageRemove(name: string, force = false): Promise<void> {
        const path = `/${this.apiVersion}/images/${encodeURIComponent(name)}${force ? "?force=1" : ""}`;
        const res = await this.requestRaw("DELETE", path, undefined, undefined, 30_000);
        // 200 = removed, 404 = already gone (treat as success).
        if (res.statusCode !== 200 && res.statusCode !== 404) {
            throw new DockerEngineError(`imageRemove(${name}) failed: ${res.statusCode}`, res.statusCode, res.body.toString("utf8"));
        }
    }

    /** GET /containers/{id}/json */
    async containerInspect(id: string): Promise<{ State: { Status: string; Running: boolean; ExitCode: number; Pid: number } }> {
        return this.requestJson("GET", `/${this.apiVersion}/containers/${id}/json`, undefined, 10_000);
    }

    // ── Low-level HTTP-over-socket plumbing ───────────────────────────

    private async requestJson<T>(method: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
        const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        const res = await this.requestRaw(method, path, payload, payload ? { "Content-Type": "application/json" } : undefined, timeoutMs);
        if (res.statusCode < 200 || res.statusCode >= 300) {
            const text = res.body.toString("utf8");
            throw new DockerEngineError(`${method} ${path} → ${res.statusCode}`, res.statusCode, text);
        }
        const text = res.body.toString("utf8").trim();
        if (!text) return {} as T;
        return JSON.parse(text) as T;
    }

    private requestRaw(method: string, path: string, body: Buffer | undefined, extraHeaders: Record<string, string> | undefined, timeoutMs: number): Promise<RawResponse> {
        return new Promise((resolve, reject) => {
            const headers: Record<string, string> = {
                Host: "localhost",
                Accept: "application/json",
                ...(extraHeaders ?? {}),
            };
            if (body) headers["Content-Length"] = String(body.length);

            const req = http.request({
                socketPath: this.socketPath,
                method,
                path,
                headers,
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
                res.on("error", reject);
            });
            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error(`Docker Engine API request timed out after ${timeoutMs} ms: ${method} ${path}`));
            });
            req.on("error", reject);
            if (body) req.write(body);
            req.end();
        });
    }
}

/** Error thrown for any non-2xx Docker Engine API response. */
export class DockerEngineError extends Error {
    readonly statusCode: number;
    readonly responseBody: string;
    constructor(message: string, statusCode: number, responseBody: string) {
        super(message);
        this.name = "DockerEngineError";
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }
}
