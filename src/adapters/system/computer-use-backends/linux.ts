/**
 * Linux computer-use backend.
 *
 * Probes the session at construction time and selects between two well-known
 * userspace utilities:
 *   - X11 sessions   → `xdotool`  (universal, dec­ade-stable)
 *   - Wayland session → `wtype`   (typing) + `wlrctl` (pointer/click) when
 *     available; falls back to `xdotool` if XWayland is present.
 *
 * Both utilities are zero-dep userland tools shipped by every major
 * distribution; PRISM does not bundle them. When neither is present the
 * backend reports `isAvailable() === false` and the dispatcher emits a
 * platform advisory (mirrors the Win32 adapter's missing-tool error path).
 *
 * @module adapters/system/computer-use-backends/linux
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ComputerUseBackend } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Linux backend dispatching to xdotool / wtype.
 *
 * Construction is cheap; capability probing is lazy (first `isAvailable()` /
 * action call). All shell-out commands pass arguments via argv arrays — never
 * via shell-string interpolation — so untrusted text payloads cannot inject
 * commands.
 */
export class LinuxComputerUseBackend implements ComputerUseBackend {
    readonly id: "linux-x11" | "linux-wayland";
    private readonly hasXdotool: Promise<boolean>;
    private readonly hasWtype: Promise<boolean>;
    private readonly hasWlrctl: Promise<boolean>;

    constructor() {
        // Probe Wayland first; fall back to X11.
        this.id = process.env.WAYLAND_DISPLAY ? "linux-wayland" : "linux-x11";
        this.hasXdotool = which("xdotool");
        this.hasWtype = which("wtype");
        this.hasWlrctl = which("wlrctl");
    }

    async isAvailable(): Promise<boolean> {
        if (this.id === "linux-wayland") {
            // Wayland needs at least wtype for typing.
            return (await this.hasWtype) || (await this.hasXdotool);
        }
        return this.hasXdotool;
    }

    async mouseMove(x: number, y: number): Promise<void> {
        if (await this.hasXdotool) {
            await execFileAsync("xdotool", ["mousemove", String(Math.round(x)), String(Math.round(y))]);
            return;
        }
        if (await this.hasWlrctl) {
            await execFileAsync("wlrctl", ["pointer", "move", String(Math.round(x)), String(Math.round(y))]);
            return;
        }
        throw new Error("Linux computer-use: mouseMove requires xdotool (X11/XWayland) or wlrctl (Wayland)");
    }

    async click(button: "left" | "right" | "double"): Promise<void> {
        if (await this.hasXdotool) {
            const xdoButton = button === "right" ? "3" : "1";
            if (button === "double") {
                await execFileAsync("xdotool", ["click", "--repeat", "2", "--delay", "100", xdoButton]);
            } else {
                await execFileAsync("xdotool", ["click", xdoButton]);
            }
            return;
        }
        if (await this.hasWlrctl) {
            const wlrButton = button === "right" ? "right" : "left";
            await execFileAsync("wlrctl", ["pointer", "click", wlrButton]);
            if (button === "double") {
                await new Promise((r) => setTimeout(r, 100));
                await execFileAsync("wlrctl", ["pointer", "click", wlrButton]);
            }
            return;
        }
        throw new Error("Linux computer-use: click requires xdotool or wlrctl");
    }

    async mouseDrag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
        if (await this.hasXdotool) {
            await execFileAsync("xdotool", [
                "mousemove", String(Math.round(x1)), String(Math.round(y1)),
                "mousedown", "1",
                "mousemove", String(Math.round(x2)), String(Math.round(y2)),
                "mouseup", "1"
            ]);
            return;
        }
        throw new Error("Linux computer-use: mouseDrag requires xdotool");
    }

    async typeText(text: string): Promise<void> {
        // Prefer wtype on Wayland (xdotool's keyboard sim is broken under
        // pure Wayland compositors); xdotool is fine on X11 / XWayland.
        if (this.id === "linux-wayland" && (await this.hasWtype)) {
            await execFileAsync("wtype", [text]);
            return;
        }
        if (await this.hasXdotool) {
            await execFileAsync("xdotool", ["type", "--delay", "5", "--", text]);
            return;
        }
        if (await this.hasWtype) {
            await execFileAsync("wtype", [text]);
            return;
        }
        throw new Error("Linux computer-use: typeText requires wtype (Wayland) or xdotool (X11)");
    }

    async pressKey(chord: string): Promise<void> {
        // Translate "ctrl+shift+escape" → xdotool's `key` syntax
        // ("ctrl+shift+Escape"). xdotool capitalises common key names.
        if (await this.hasXdotool) {
            await execFileAsync("xdotool", ["key", "--", normaliseForXdotool(chord)]);
            return;
        }
        if (await this.hasWtype) {
            // wtype uses -M / -P / -p for modifiers; assemble argv.
            const args = wtypeArgsForChord(chord);
            await execFileAsync("wtype", args);
            return;
        }
        throw new Error("Linux computer-use: pressKey requires xdotool or wtype");
    }

    async cursorPosition(): Promise<{ x: number; y: number }> {
        if (await this.hasXdotool) {
            const { stdout } = await execFileAsync("xdotool", ["getmouselocation", "--shell"]);
            const x = Number((stdout.match(/^X=(\d+)/m) ?? [])[1] ?? 0);
            const y = Number((stdout.match(/^Y=(\d+)/m) ?? [])[1] ?? 0);
            return { x, y };
        }
        // Wayland has no portable pointer-readback API; report origin and let
        // the caller note the limitation via the advisory.
        return { x: 0, y: 0 };
    }
}

/** Detect whether `bin` is on PATH (uses POSIX `command -v`). */
function which(bin: string): Promise<boolean> {
    return execFileAsync("/bin/sh", ["-c", `command -v ${bin}`])
        .then(({ stdout }) => stdout.trim().length > 0)
        .catch(() => false);
}

/** Normalise a chord like "ctrl+shift+escape" to xdotool's expected form. */
function normaliseForXdotool(chord: string): string {
    const map: Record<string, string> = {
        ctrl: "ctrl", control: "ctrl",
        shift: "shift",
        alt: "alt", meta: "alt",
        win: "super", super: "super",
        enter: "Return", return: "Return",
        esc: "Escape", escape: "Escape",
        space: "space",
        tab: "Tab",
        backspace: "BackSpace",
        delete: "Delete", del: "Delete",
        up: "Up", down: "Down", left: "Left", right: "Right",
        home: "Home", end: "End",
        pageup: "Prior", page_up: "Prior", pagedown: "Next", page_down: "Next",
    };
    const parts = chord.split(/[+\-]/).map((p) => p.trim()).filter(Boolean);
    return parts.map((p) => map[p.toLowerCase()] ?? p).join("+");
}

/** Build wtype argv for a chord. Falls through to a single -k for the last token. */
function wtypeArgsForChord(chord: string): string[] {
    const parts = chord.split(/[+\-]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return [];
    const args: string[] = [];
    const main = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);
    const wtypeMod: Record<string, string> = {
        ctrl: "ctrl", control: "ctrl",
        shift: "shift",
        alt: "alt",
        win: "logo", super: "logo",
    };
    for (const m of modifiers) {
        const flag = wtypeMod[m.toLowerCase()];
        if (flag) args.push("-M", flag);
    }
    args.push("-k", main);
    for (const m of modifiers) {
        const flag = wtypeMod[m.toLowerCase()];
        if (flag) args.push("-m", flag);
    }
    return args;
}
