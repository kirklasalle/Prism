/**
 * ConsoleInterceptor — wraps process.stdout.write and process.stderr.write so
 * that every line emitted by the PRISM process (or any of its children that
 * write to this process's stdio) is captured into a bounded ring buffer and
 * fanned out to subscribers.
 *
 * Used by the dashboard's "Live Console" panel and `GET /api/debug/console`.
 *
 * Design constraints:
 *   - Re-entrant safe (callbacks must not re-enter the wrapped writes).
 *   - Original write semantics preserved exactly: every byte still goes to the
 *     real terminal so existing log files / launchers are unaffected.
 *   - Secrets are redacted before storage / fan-out (admin token + common
 *     *_SECRET / *_TOKEN / *_KEY env values).
 *   - Process-wide singleton so multiple subsystems share the same buffer.
 */

import fs from "node:fs";
import path from "node:path";

export interface ConsoleLine {
    /** ISO 8601 timestamp. */
    ts: string;
    stream: "stdout" | "stderr";
    line: string;
}

export type ConsoleLineListener = (line: ConsoleLine) => void;

const RING_CAPACITY = 5000;

const SECRET_ENV_KEY_REGEX = /(SECRET|TOKEN|KEY|PASSWORD|PASSPHRASE|API_KEY)$/i;

/**
 * Build a redaction function from the current environment. Captured at install
 * time so that values rotated later in the process lifetime won't accidentally
 * leak: the operator should restart PRISM after rotating a secret anyway.
 */
function buildRedactor(): (s: string) => string {
    const secrets: string[] = [];
    for (const [k, v] of Object.entries(process.env)) {
        if (!v || v.length < 6) continue; // skip empty / trivial values
        if (SECRET_ENV_KEY_REGEX.test(k)) secrets.push(v);
    }
    // Longer values first so we don't redact a prefix that's part of a longer secret.
    secrets.sort((a, b) => b.length - a.length);
    return (s: string): string => {
        let out = s;
        for (const v of secrets) {
            if (out.includes(v)) {
                out = out.split(v).join("[REDACTED]");
            }
        }
        // Also redact the admin-token printout regardless of env presence.
        out = out.replace(/(\[AUTH\][^\n]*?token[^\n]*?:\s*)([A-Za-z0-9+/=._-]{8,})/gi,
            "$1[REDACTED]");
        return out;
    };
}

export class ConsoleInterceptor {
    private readonly buffer: ConsoleLine[] = [];
    private readonly listeners = new Set<ConsoleLineListener>();
    private readonly redact: (s: string) => string;
    private originalStdoutWrite: typeof process.stdout.write | null = null;
    private originalStderrWrite: typeof process.stderr.write | null = null;
    private installed = false;
    /** Re-entrancy guard: true while emitting a line to listeners. */
    private inEmit = false;
    /** Per-stream pending fragment for partial-line buffering. */
    private pending = { stdout: "", stderr: "" };

    constructor() {
        this.redact = buildRedactor();
    }

    /** Install the wrappers. Idempotent. */
    install(): void {
        if (this.installed) return;
        this.installed = true;
        const self = this;

        const stdout = process.stdout;
        const stderr = process.stderr;
        // Save the EXACT existing function references so uninstall() can
        // restore them without altering identity (binding would change it).
        this.originalStdoutWrite = stdout.write;
        this.originalStderrWrite = stderr.write;

        const wrap = (
            stream: "stdout" | "stderr",
            original: typeof process.stdout.write,
        ): typeof process.stdout.write => {
            // The 3-arity overload of write is: (chunk, encoding?, callback?) => boolean
            // We preserve the signature exactly so node's typings remain happy.
            const wrapped = function (
                this: NodeJS.WriteStream,
                chunk: unknown,
                encodingOrCb?: unknown,
                cb?: unknown,
            ): boolean {
                // Always pass through to the real terminal first so we never
                // hide output even if our capture path throws.
                // eslint-disable-next-line prefer-rest-params, @typescript-eslint/no-explicit-any
                const result = (original as any).apply(this, arguments as unknown as unknown[]);
                if (!self.inEmit) {
                    try {
                        self.captureChunk(stream, chunk);
                    } catch {
                        // never let capture break stdio
                    }
                }
                void encodingOrCb; void cb;
                return result as boolean;
            };
            return wrapped as typeof process.stdout.write;
        };

        process.stdout.write = wrap("stdout", this.originalStdoutWrite);
        process.stderr.write = wrap("stderr", this.originalStderrWrite);
    }

    /** Restore the original writers. */
    uninstall(): void {
        if (!this.installed) return;
        if (this.originalStdoutWrite) process.stdout.write = this.originalStdoutWrite;
        if (this.originalStderrWrite) process.stderr.write = this.originalStderrWrite;
        this.installed = false;
    }

    /** Subscribe to live lines. Returns an unsubscribe function. */
    onLine(listener: ConsoleLineListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** Snapshot of the most recent up to `limit` lines (oldest first). */
    getTail(limit = 500): ConsoleLine[] {
        const n = Math.max(1, Math.min(RING_CAPACITY, limit));
        return this.buffer.slice(Math.max(0, this.buffer.length - n));
    }

    /** Inject a synthetic line (e.g. from a non-stdio source). */
    push(stream: "stdout" | "stderr", line: string): void {
        this.recordLine(stream, line);
    }

    /** Drop all buffered lines. */
    clear(): void {
        this.buffer.length = 0;
    }

    private captureChunk(stream: "stdout" | "stderr", chunk: unknown): void {
        const text = typeof chunk === "string"
            ? chunk
            : Buffer.isBuffer(chunk) ? chunk.toString("utf-8")
            : String(chunk);
        const combined = this.pending[stream] + text;
        const parts = combined.split(/\r?\n/);
        // Last element is the partial trailing fragment (no newline yet).
        this.pending[stream] = parts.pop() ?? "";
        for (const line of parts) {
            if (line.length === 0) continue;
            this.recordLine(stream, line);
        }
    }

    private recordLine(stream: "stdout" | "stderr", rawLine: string): void {
        const redacted = this.redact(rawLine);
        const entry: ConsoleLine = {
            ts: new Date().toISOString(),
            stream,
            line: redacted,
        };
        this.buffer.push(entry);
        if (this.buffer.length > RING_CAPACITY) {
            this.buffer.splice(0, this.buffer.length - RING_CAPACITY);
        }

        // Write to persistent logs folder on disk in real time
        try {
            const logDir = "D:\\Projects\\Prism\\logs";
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logLine = `[${entry.ts}] [${stream.toUpperCase()}] ${redacted}\n`;
            fs.appendFileSync(path.join(logDir, "prism.log"), logLine, "utf-8");
        } catch (err) {
            // Graceful degradation if disk is locked
        }

        this.inEmit = true;
        try {
            for (const listener of this.listeners) {
                try { listener(entry); } catch { /* swallow listener errors */ }
            }
        } finally {
            this.inEmit = false;
        }
    }
}

let singleton: ConsoleInterceptor | null = null;

/** Return (and lazily create) the process-wide ConsoleInterceptor. */
export function getConsoleInterceptor(): ConsoleInterceptor {
    if (!singleton) singleton = new ConsoleInterceptor();
    return singleton;
}
