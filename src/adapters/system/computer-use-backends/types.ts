/**
 * Computer-use backend interface (cross-platform abstraction).
 *
 * The legacy `ComputerUseTool` was Win32-only. Phase R+ v0.19 introduces
 * platform-specific backends so the same `computer` tool surface (mouse +
 * keyboard + cursor) works on Linux (X11 / Wayland) and macOS without
 * disturbing the existing PowerShell + Win32 SendInput implementation.
 *
 * Each backend method is small, idempotent, and may rely on widely-available
 * system utilities (`xdotool`, `wtype`, `osascript`). PRISM does not bundle
 * these — the Linux backend probes for them at construction time and surfaces
 * a clear advisory if missing, mirroring the pattern already used by other
 * optional adapters.
 *
 * @module adapters/system/computer-use-backends/types
 */

export interface ComputerUseBackend {
    /** Backend discriminator (used for telemetry + advisories). */
    readonly id: "win32" | "linux-x11" | "linux-wayland" | "macos";

    /** Whether the backend is functional in the current environment. */
    isAvailable(): Promise<boolean>;

    /** Move the mouse pointer to absolute screen coordinates. */
    mouseMove(x: number, y: number): Promise<void>;

    /** Synthesize a click at the current pointer location. */
    click(button: "left" | "right" | "double"): Promise<void>;

    /** Type a Unicode string into the focused window. */
    typeText(text: string): Promise<void>;

    /** Press a single key chord (e.g. "ctrl+shift+escape"). */
    pressKey(chord: string): Promise<void>;

    /** Return current absolute cursor position in screen coordinates. */
    cursorPosition(): Promise<{ x: number; y: number }>;
}
