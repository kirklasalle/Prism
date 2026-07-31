/**
 * R5-4 — Structured logger facade.
 *
 * Single, dependency-free log facade. Format is selected by
 * `PRISM_LOG_FORMAT`:
 *
 *   - `text`  (default) — `[ISO] LEVEL msg key=value …`
 *   - `json`            — `{"ts":..., "level":..., "msg":..., op?, ...ctx}`
 *
 * The default level is `info`; `PRISM_LOG_LEVEL=debug` opens it up.
 * `PRISM_LOG_LEVEL=trace` opens full diagnostics including wizard model
 * population and Guardian configuration tracing.
 *
 * All existing `console.*` call sites in the codebase continue to work — this
 * module is **opt-in**: subsystems that want machine-parseable logs
 * import `logger` from here.
 */

import { join } from "node:path";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { trace: 5, debug: 10, info: 20, warn: 30, error: 40 };

export type LogFormat = "text" | "json";

export interface LogContext {
    /** Operation tag (free-form) — appears in JSON mode as the `op` field. */
    op?: string;
    /** Free-form structured fields. Values must be JSON-serializable. */
    [key: string]: unknown;
}

export interface LogRecord {
    ts: string;
    level: LogLevel;
    msg: string;
    op?: string;
    [key: string]: unknown;
}

export interface LoggerConfig {
    format: LogFormat;
    minLevel: LogLevel;
    /** Sink — defaults to `process.stdout.write`. Tests inject a buffer. */
    sink: (line: string) => void;
}

function readEnvFormat(env: NodeJS.ProcessEnv): LogFormat {
    const raw = (env.PRISM_LOG_FORMAT ?? "").toLowerCase();
    return raw === "json" ? "json" : "text";
}

function readEnvLevel(env: NodeJS.ProcessEnv): LogLevel {
    const raw = (env.PRISM_LOG_LEVEL ?? "").toLowerCase();
    if (raw === "trace" || raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
    return "info";
}

/** Resolve the logs directory for file-based trace output. */
function resolveLogDir(): string {
    return join(process.cwd(), "logs");
}

/** Resolve config from current `process.env`. Re-reads on each call. */
export function resolveLoggerConfig(env: NodeJS.ProcessEnv = process.env): LoggerConfig {
    return {
        format: readEnvFormat(env),
        minLevel: readEnvLevel(env),
        sink: (line) => {
            process.stdout.write(line + "\n");
        },
    };
}

function escapeTextValue(v: unknown): string {
    if (v == null) return String(v);
    if (typeof v === "string") {
        // Quote when the value contains whitespace or `=` so each pair stays parseable.
        return /[\s="]/.test(v) ? JSON.stringify(v) : v;
    }
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

export function formatRecord(record: LogRecord, format: LogFormat): string {
    if (format === "json") {
        // Stable insertion order: ts, level, msg, op, ...rest.
        const ordered: Record<string, unknown> = { ts: record.ts, level: record.level, msg: record.msg };
        if (record.op !== undefined) ordered.op = record.op;
        for (const [k, v] of Object.entries(record)) {
            if (k === "ts" || k === "level" || k === "msg" || k === "op") continue;
            ordered[k] = v;
        }
        return JSON.stringify(ordered);
    }
    // text mode
    const parts: string[] = [`[${record.ts}]`, record.level.toUpperCase().padEnd(5), record.msg];
    if (record.op !== undefined) parts.push(`op=${escapeTextValue(record.op)}`);
    for (const [k, v] of Object.entries(record)) {
        if (k === "ts" || k === "level" || k === "msg" || k === "op") continue;
        parts.push(`${k}=${escapeTextValue(v)}`);
    }
    return parts.join(" ");
}

export class Logger {
    private cfg: LoggerConfig;

    constructor(cfg?: Partial<LoggerConfig>) {
        const base = resolveLoggerConfig();
        this.cfg = { ...base, ...cfg };
    }

    /** Re-read env (e.g. after a setup wizard updates `PRISM_LOG_FORMAT`). */
    refresh(): void {
        const next = resolveLoggerConfig();
        this.cfg = { ...next, sink: this.cfg.sink };
    }

    private emit(level: LogLevel, msg: string, ctx?: LogContext): void {
        if (LEVEL_RANK[level] < LEVEL_RANK[this.cfg.minLevel]) return;
        const record: LogRecord = {
            ts: new Date().toISOString(),
            level,
            msg,
            ...(ctx ?? {}),
        };
        const formatted = formatRecord(record, this.cfg.format);
        this.cfg.sink(formatted);
        this.writeToTraceFile(formatted);
    }

    /** Append a line to trace/log files in logs/ directory. */
    private writeToTraceFile(line: string): void {
        try {
            const dir = resolveLogDir();
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            appendFileSync(join(dir, "prism-trace.log"), line + "\n", "utf-8");
            appendFileSync(join(dir, "prism.log"), line + "\n", "utf-8");
        } catch {
            /* never break operations for logging */
        }
    }

    trace(msg: string, ctx?: LogContext): void {
        this.emit("trace", msg, ctx);
    }
    debug(msg: string, ctx?: LogContext): void {
        this.emit("debug", msg, ctx);
    }
    info(msg: string, ctx?: LogContext): void {
        this.emit("info", msg, ctx);
    }
    warn(msg: string, ctx?: LogContext): void {
        this.emit("warn", msg, ctx);
    }
    error(msg: string, ctx?: LogContext): void {
        this.emit("error", msg, ctx);
    }

    /** Test/inspection hook — current effective format. */
    getFormat(): LogFormat {
        return this.cfg.format;
    }
    /** Test/inspection hook — current effective minimum level. */
    getMinLevel(): LogLevel {
        return this.cfg.minLevel;
    }
}

/** Process-wide default logger. */
export const logger = new Logger();
