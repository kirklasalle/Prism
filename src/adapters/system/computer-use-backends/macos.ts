/**
 * macOS computer-use backend.
 *
 * Uses `osascript` (built-in on every macOS release since 10.6) driving the
 * `System Events` scripting addition for keyboard + mouse synthesis, and
 * Quartz for cursor readback via a one-shot Swift line. No native bindings,
 * no signed Swift shim binary — those can be layered in a future slice for
 * Wayland-style raw-event delivery; this slice prioritises a working real
 * implementation across the whole macOS install base today.
 *
 * Caveats called out by the host advisory:
 *   - First use prompts the user to grant Accessibility permission to the
 *     parent terminal / Electron process.
 *   - `osascript` keypress synthesis runs at the application-events layer,
 *     not the Quartz hardware-input layer; sufficient for UI automation but
 *     does not bypass system modal dialogs.
 *
 * @module adapters/system/computer-use-backends/macos
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ComputerUseBackend } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * macOS backend driving `System Events` via `osascript`.
 *
 * All AppleScript payloads are parameterised — text/key/coordinate values
 * are passed via `osascript -e` with the value pre-escaped, never via shell
 * interpolation, so untrusted input cannot break out of string literals.
 */
export class MacOSComputerUseBackend implements ComputerUseBackend {
    readonly id = "macos" as const;

    async isAvailable(): Promise<boolean> {
        try {
            await execFileAsync("/usr/bin/osascript", ["-e", "return 1"]);
            return true;
        } catch {
            return false;
        }
    }

    async mouseMove(x: number, y: number): Promise<void> {
        // System Events lacks a direct mouse-move; use the `cliclick` tool
        // when present (brew-installable) and fall back to a Quartz Swift
        // one-liner via `swift -e` when not. Pure osascript cannot move the
        // hardware cursor without "do shell script", so we route through the
        // most reliable path available.
        if (await commandExists("cliclick")) {
            await execFileAsync("/usr/bin/env", ["cliclick", `m:${Math.round(x)},${Math.round(y)}`]);
            return;
        }
        if (await commandExists("swift")) {
            const code = `import Cocoa; CGWarpMouseCursorPosition(CGPoint(x: ${Math.round(x)}, y: ${Math.round(y)}))`;
            await execFileAsync("/usr/bin/env", ["swift", "-e", code]);
            return;
        }
        throw new Error("macOS computer-use: mouseMove needs `cliclick` (brew install cliclick) or Apple's `swift` toolchain");
    }

    async click(button: "left" | "right" | "double"): Promise<void> {
        if (await commandExists("cliclick")) {
            // cliclick clicks at the current cursor position when no coords given.
            const cmd = button === "right" ? "rc:." : button === "double" ? "dc:." : "c:.";
            await execFileAsync("/usr/bin/env", ["cliclick", cmd]);
            return;
        }
        // Pure-osascript fallback: System Events click at current position.
        // `tell application "System Events"` does not expose a click action
        // by default; wrap a low-level click via Quartz when swift is around.
        if (await commandExists("swift")) {
            const click = button === "right" ? ".right" : ".left";
            const repeat = button === "double" ? 2 : 1;
            const code = `
import Cocoa
let pos = CGEvent(source: nil)?.location ?? .zero
let down = CGEventType.${button === "right" ? "rightMouseDown" : "leftMouseDown"}
let up   = CGEventType.${button === "right" ? "rightMouseUp" : "leftMouseUp"}
for _ in 0..<${repeat} {
  CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: pos, mouseButton: ${click === ".right" ? "CGMouseButton.right" : "CGMouseButton.left"})?.post(tap: .cghidEventTap)
  CGEvent(mouseEventSource: nil, mouseType: up,   mouseCursorPosition: pos, mouseButton: ${click === ".right" ? "CGMouseButton.right" : "CGMouseButton.left"})?.post(tap: .cghidEventTap)
}
`.trim();
            await execFileAsync("/usr/bin/env", ["swift", "-e", code]);
            return;
        }
        throw new Error("macOS computer-use: click needs `cliclick` or Apple's `swift` toolchain");
    }

    async mouseDrag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
        if (await commandExists("cliclick")) {
            await execFileAsync("/usr/bin/env", ["cliclick", `dd:${x1},${y1}`, `du:${x2},${y2}`]);
            return;
        }
        const script = `tell application "System Events" to drag from {${x1}, ${y1}} to {${x2}, ${y2}}`;
        await execFileAsync("/usr/bin/osascript", ["-e", script]);
    }

    async typeText(text: string): Promise<void> {
        const escaped = appleScriptEscape(text);
        const script = `tell application "System Events" to keystroke "${escaped}"`;
        await execFileAsync("/usr/bin/osascript", ["-e", script]);
    }

    async pressKey(chord: string): Promise<void> {
        const { keyCode, modifiers } = mapChordToAppleScript(chord);
        const modList = modifiers.length ? ` using {${modifiers.join(", ")}}` : "";
        // System Events distinguishes between "key code N" (raw) and
        // "keystroke S" (Unicode); for chords we use key code so modifiers
        // work uniformly.
        const script = `tell application "System Events" to key code ${keyCode}${modList}`;
        await execFileAsync("/usr/bin/osascript", ["-e", script]);
    }

    async cursorPosition(): Promise<{ x: number; y: number }> {
        if (await commandExists("cliclick")) {
            const { stdout } = await execFileAsync("/usr/bin/env", ["cliclick", "p"]);
            const m = stdout.trim().match(/(-?\d+),\s*(-?\d+)/);
            if (m) return { x: Number(m[1]), y: Number(m[2]) };
        }
        if (await commandExists("swift")) {
            const code = `import Cocoa; let p = CGEvent(source: nil)?.location ?? .zero; print("\\(Int(p.x)),\\(Int(p.y))")`;
            const { stdout } = await execFileAsync("/usr/bin/env", ["swift", "-e", code]);
            const m = stdout.trim().match(/(-?\d+),(-?\d+)/);
            if (m) return { x: Number(m[1]), y: Number(m[2]) };
        }
        return { x: 0, y: 0 };
    }
}

function commandExists(bin: string): Promise<boolean> {
    return execFileAsync("/bin/sh", ["-c", `command -v ${bin}`])
        .then(({ stdout }) => stdout.trim().length > 0)
        .catch(() => false);
}

/** Escape a string for safe inclusion inside an AppleScript double-quoted literal. */
function appleScriptEscape(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

/** Apple key-code constants (subset matching the Win32 VK table semantically). */
const APPLE_KEY_CODES: Record<string, number> = {
    enter: 36, return: 36,
    tab: 48, space: 49,
    delete: 51, backspace: 51, del: 117,
    escape: 53, esc: 53,
    left: 123, right: 124, down: 125, up: 126,
    home: 115, end: 119, pageup: 116, pagedown: 121, page_up: 116, page_down: 121,
    f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
    f9: 101, f10: 109, f11: 103, f12: 111,
};

const APPLE_MODIFIER_NAMES: Record<string, string> = {
    ctrl: "control down", control: "control down",
    shift: "shift down",
    alt: "option down", option: "option down",
    cmd: "command down", command: "command down",
    win: "command down", super: "command down",
};

function mapChordToAppleScript(chord: string): { keyCode: number; modifiers: string[] } {
    const parts = chord.split(/[+\-]/).map((p) => p.trim()).filter(Boolean);
    const main = parts[parts.length - 1].toLowerCase();
    const modifiers = parts.slice(0, -1)
        .map((m) => APPLE_MODIFIER_NAMES[m.toLowerCase()])
        .filter((m): m is string => Boolean(m));
    const keyCode = APPLE_KEY_CODES[main];
    if (keyCode === undefined) {
        throw new Error(`macOS computer-use: unsupported key in chord "${chord}" (token: "${main}")`);
    }
    return { keyCode, modifiers };
}
