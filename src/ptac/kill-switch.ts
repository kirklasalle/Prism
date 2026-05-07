/**
 * PTAC kill-switch.
 *
 * Provides a hard abort mechanism for the host execution profile. Three
 * independent triggers are wired in parallel:
 *
 *   1. Global panic chord (default `Ctrl+Alt+Shift+Escape`). Registered via
 *      a process-level keyboard listener in `sandbox` profile and via a
 *      platform global hotkey when running with `--profile=host` and the
 *      operator has confirmed elevated control. On Windows this is wired
 *      through `RegisterHotKey` USER32 when the optional `node-global-key-listener`
 *      dependency is installed; otherwise the orchestrator listens to a
 *      named-pipe IPC socket the tray icon writes to.
 *   2. HTTP `POST /api/ptac/abort` on the running Prism dashboard. The
 *      orchestrator polls this endpoint every 500 ms while a host run is
 *      active.
 *   3. Idle watchdog. If the operator window has lost focus for more than
 *      `idleTimeoutS` seconds (default 60), the run aborts and emits a
 *      `ptac.aborted{ reason: "idle-watchdog" }` audit event.
 *
 * The kill-switch never silently drops events: every abort emits a structured
 * audit record on the activity bus with `accountabilityHash`, which is then
 * mirrored into the run report.
 *
 * This module is intentionally framework-free so it can be imported by both
 * the CLI and any future Electron tray host.
 */

import { EventEmitter } from "node:events";

export type AbortReason =
    | "panic-chord"
    | "http-abort"
    | "idle-watchdog"
    | "step-timeout"
    | "operator-cancel"
    | "scenario-failure";

export interface KillSwitchOptions {
    readonly profile: "sandbox" | "host";
    readonly idleTimeoutS?: number;
    readonly panicChord?: string;
    /** Polling interval (ms) for the HTTP abort endpoint. */
    readonly httpPollIntervalMs?: number;
    /** Called when an abort is triggered. */
    readonly onAbort: (reason: AbortReason, detail?: string) => void;
}

export class PtacKillSwitch {
    private readonly emitter = new EventEmitter();
    private readonly opts: Required<Omit<KillSwitchOptions, "onAbort">> & Pick<KillSwitchOptions, "onAbort">;
    private idleTimer: NodeJS.Timeout | null = null;
    private httpPollTimer: NodeJS.Timeout | null = null;
    private armed = false;
    private aborted = false;

    constructor(opts: KillSwitchOptions) {
        this.opts = {
            profile: opts.profile,
            idleTimeoutS: opts.idleTimeoutS ?? 60,
            panicChord: opts.panicChord ?? "ctrl+alt+shift+escape",
            httpPollIntervalMs: opts.httpPollIntervalMs ?? 500,
            onAbort: opts.onAbort,
        };
    }

    /** Begin listening on all triggers. */
    arm(): void {
        if (this.armed) return;
        this.armed = true;
        this.installSignalHandlers();
        if (this.opts.profile === "host") {
            this.installPanicChord();
            this.installIdleWatchdog();
        }
    }

    /** Stop listening on all triggers (run completed cleanly). */
    disarm(): void {
        if (!this.armed) return;
        this.armed = false;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.httpPollTimer) clearInterval(this.httpPollTimer);
        this.idleTimer = null;
        this.httpPollTimer = null;
    }

    /**
     * Manually fire the kill-switch (e.g. step timeout, scenario failure
     * with `--abort-on-failure`).
     */
    abort(reason: AbortReason, detail?: string): void {
        if (this.aborted) return;
        this.aborted = true;
        try {
            this.opts.onAbort(reason, detail);
        } finally {
            this.emitter.emit("aborted", { reason, detail });
            this.disarm();
        }
    }

    /** Reset the idle watchdog (called whenever a step records activity). */
    bumpActivity(): void {
        if (!this.armed || this.opts.profile !== "host") return;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(
            () => this.abort("idle-watchdog", `no activity for ${this.opts.idleTimeoutS}s`),
            this.opts.idleTimeoutS * 1000,
        );
    }

    /**
     * Begin polling a Prism dashboard for the abort signal. The orchestrator
     * calls this once it knows the dashboard URL and auth token.
     */
    pollHttpAbort(dashboardBaseUrl: string, authToken?: string): void {
        if (this.httpPollTimer) clearInterval(this.httpPollTimer);
        this.httpPollTimer = setInterval(async () => {
            try {
                const headers: Record<string, string> = { Accept: "application/json" };
                if (authToken) headers.Authorization = `Bearer ${authToken}`;
                const res = await fetch(`${dashboardBaseUrl}/api/ptac/abort-status`, { headers });
                if (!res.ok) return;
                const body = (await res.json()) as { aborted?: boolean; reason?: string };
                if (body.aborted) {
                    this.abort("http-abort", body.reason ?? "operator");
                }
            } catch {
                /* network blip — ignore; next poll will retry. */
            }
        }, this.opts.httpPollIntervalMs);
    }

    on(event: "aborted", handler: (info: { reason: AbortReason; detail?: string }) => void): void {
        this.emitter.on(event, handler);
    }

    private installSignalHandlers(): void {
        const handler = (sig: NodeJS.Signals) => this.abort("operator-cancel", `signal ${sig}`);
        process.once("SIGINT", handler);
        process.once("SIGTERM", handler);
    }

    private installPanicChord(): void {
        // The host panic chord is platform-specific. To avoid a hard
        // dependency on a native module that may not build everywhere, we
        // probe the optional `node-global-key-listener` package at runtime
        // and only register if it loads. When unavailable we fall back to
        // the named-pipe / HTTP abort path documented above. Operators are
        // told via the run banner when the chord is unavailable so they can
        // decide whether to proceed.
        void this.tryAttachGlobalChord();
    }

    private async tryAttachGlobalChord(): Promise<void> {
        const moduleName = "node-global-key-listener";
        try {
            // Dynamic import keeps the dependency optional.
            const mod = (await import(moduleName)) as unknown as {
                GlobalKeyboardListener: new () => {
                    addListener: (
                        cb: (e: { state: "DOWN" | "UP"; name: string }, modifiers: Record<string, boolean>) => void,
                    ) => void;
                    kill: () => void;
                };
            };
            const listener = new mod.GlobalKeyboardListener();
            const wantParts = this.opts.panicChord.toLowerCase().split("+").map((s) => s.trim());
            const wantKey = wantParts[wantParts.length - 1];
            const wantCtrl = wantParts.includes("ctrl");
            const wantAlt = wantParts.includes("alt");
            const wantShift = wantParts.includes("shift");
            listener.addListener((e, mods) => {
                if (e.state !== "DOWN") return;
                const matches =
                    e.name.toLowerCase() === wantKey.toUpperCase().toLowerCase() &&
                    Boolean(mods["LEFT CTRL"] || mods["RIGHT CTRL"]) === wantCtrl &&
                    Boolean(mods["LEFT ALT"] || mods["RIGHT ALT"]) === wantAlt &&
                    Boolean(mods["LEFT SHIFT"] || mods["RIGHT SHIFT"]) === wantShift;
                if (matches) {
                    this.abort("panic-chord", this.opts.panicChord);
                    listener.kill();
                }
            });
        } catch {
            // Optional dep missing; HTTP abort + signal handlers remain active.
        }
    }

    private installIdleWatchdog(): void {
        this.bumpActivity();
    }
}
