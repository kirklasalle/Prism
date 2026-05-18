import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import { FramebufferCapture } from "../../core/operator/framebuffer-capture.js";
import type { ToolContract } from "../../core/tools/contracts.js";
import type { ComputerUseBackend } from "./computer-use-backends/types.js";
import { LinuxComputerUseBackend } from "./computer-use-backends/linux.js";
import { MacOSComputerUseBackend } from "./computer-use-backends/macos.js";

const execFileAsync = promisify(execFile);

/**
 * Select the appropriate non-Win32 backend at construction. Returns
 * `undefined` on Win32 so the original PowerShell SendInput path runs
 * unchanged (Frontend Protection at the adapter layer — Win32 codepaths
 * already shipped and tested are not refactored).
 */
function selectNonWin32Backend(): ComputerUseBackend | undefined {
  if (process.platform === "linux") return new LinuxComputerUseBackend();
  if (process.platform === "darwin") return new MacOSComputerUseBackend();
  return undefined;
}

/**
 * Computer Use Tool — World-class system automation for Prism agents.
 * 
 * Provides mouse and keyboard control for Windows systems, following the
 * Anthropic "Computer Use" API pattern.
 */
export class ComputerUseTool implements Tool {
  readonly name = "computer";
  readonly contract: ToolContract = {
    version: "1.0.0",
    args: {
      action: {
        type: "string",
        enum: [
          "key",
          "type",
          "mouse_move",
          "left_click",
          "left_click_drag",
          "right_click",
          "middle_click",
          "double_click",
          "screenshot",
          "cursor_position"
        ],
        required: true
      },
      text: { type: "string", required: false },
      coordinate: { type: "array", items: { type: "number" }, required: false } as any,
    }
  } as const;

  private readonly framebufferCapture: FramebufferCapture;
  private readonly nonWin32Backend: ComputerUseBackend | undefined;

  constructor(
    framebufferCapture?: FramebufferCapture,
    backend?: ComputerUseBackend,
  ) {
    this.framebufferCapture = framebufferCapture ?? new FramebufferCapture();
    this.nonWin32Backend = backend ?? selectNonWin32Backend();
  }

  /** Test/diagnostic accessor for the active non-Win32 backend (if any). */
  getBackendId(): "win32" | "linux-x11" | "linux-wayland" | "macos" {
    if (this.nonWin32Backend) return this.nonWin32Backend.id;
    return "win32";
  }

  async execute(request: ToolRequest): Promise<ToolResult> {
    const { action, text, coordinate } = request.args as {
      action: string;
      text?: string;
      coordinate?: [number, number];
    };

    try {
      switch (action) {
        case "screenshot":
          return await this.handleScreenshot();
        case "mouse_move":
          if (!coordinate) throw new Error("Coordinate required for mouse_move");
          return await this.handleMouseMove(coordinate[0], coordinate[1]);
        case "left_click":
          return await this.handleClick("left");
        case "right_click":
          return await this.handleClick("right");
        case "double_click":
          return await this.handleClick("double");
        case "type":
          if (!text) throw new Error("Text required for type");
          return await this.handleType(text);
        case "key":
          if (!text) throw new Error("Key sequence required for key");
          return await this.handleKey(text);
        case "cursor_position":
          return await this.handleCursorPosition();
        default:
          return { ok: false, output: { error: `Unsupported action: ${action}` } };
      }
    } catch (error: unknown) {
      return { ok: false, output: { error: (error as Error).message ?? "Computer action failed" } };
    }
  }

  private async handleScreenshot(): Promise<ToolResult> {
    const result = await this.framebufferCapture.captureSingle();
    return {
      ok: true,
      output: {
        type: "image",
        filename: result.filename,
        timestamp: result.timestamp
      }
    };
  }

  private async handleMouseMove(x: number, y: number): Promise<ToolResult> {
    if (this.nonWin32Backend) {
      await this.nonWin32Backend.mouseMove(x, y);
      return { ok: true, output: { x, y, backend: this.nonWin32Backend.id } };
    }
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
    `;
    await this.runPowerShell(script);
    return { ok: true, output: { x, y } };
  }

  private async handleClick(button: "left" | "right" | "double"): Promise<ToolResult> {
    if (this.nonWin32Backend) {
      await this.nonWin32Backend.click(button);
      return { ok: true, output: { action: button + "_click", backend: this.nonWin32Backend.id } };
    }
    const script = `
      Add-Type -TypeDefinition @"
      using System;
      using System.Runtime.InteropServices;
      public class MouseControl {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
          public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
          public const uint MOUSEEVENTF_LEFTUP = 0x04;
          public const uint MOUSEEVENTF_RIGHTDOWN = 0x08;
          public const uint MOUSEEVENTF_RIGHTUP = 0x10;
      }
"@
      if ("${button}" -eq "left") {
          [MouseControl]::mouse_event([MouseControl]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
          [MouseControl]::mouse_event([MouseControl]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
      } elseif ("${button}" -eq "right") {
          [MouseControl]::mouse_event([MouseControl]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
          [MouseControl]::mouse_event([MouseControl]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
      } elseif ("${button}" -eq "double") {
          [MouseControl]::mouse_event([MouseControl]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
          [MouseControl]::mouse_event([MouseControl]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
          Start-Sleep -Milliseconds 100
          [MouseControl]::mouse_event([MouseControl]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
          [MouseControl]::mouse_event([MouseControl]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
      }
    `;
    await this.runPowerShell(script);
    return { ok: true, output: { action: button + "_click" } };
  }

  private async handleType(text: string): Promise<ToolResult> {
    if (this.nonWin32Backend) {
      await this.nonWin32Backend.typeText(text);
      return { ok: true, output: { typed: text, backend: this.nonWin32Backend.id } };
    }
    // Win32 SendInput with KEYEVENTF_UNICODE — sends each codepoint as a
    // synthesized hardware keystroke. Reliable across all foreground apps,
    // does not require keyboard focus to be the desktop, and (unlike the
    // legacy `SendKeys.SendWait` path) has no escape-injection surface
    // because the payload is read from an environment variable, never
    // interpolated into the script body.
    const script = SEND_INPUT_TYPE_SCRIPT;
    await this.runPowerShell(script, { PRISM_SENDINPUT_TEXT: text });
    return { ok: true, output: { typed: text, backend: "Win32.SendInput" } };
  }

  private async handleKey(key: string): Promise<ToolResult> {
    if (this.nonWin32Backend) {
      await this.nonWin32Backend.pressKey(key);
      return { ok: true, output: { key, backend: this.nonWin32Backend.id } };
    }
    // Map common high-level key names to Win32 virtual-key codes.
    // Modifier prefixes ("ctrl+", "shift+", "alt+", "win+", "+", "^", "%")
    // are honoured by issuing keydown for the modifier(s), then keydown +
    // keyup for the main key, then keyup for the modifier(s) — the canonical
    // SendInput chord pattern.
    const parsed = parseKeyChord(key);
    if (!parsed) {
      return { ok: false, output: { error: `Unsupported key: ${key}` } };
    }
    const script = SEND_INPUT_KEY_SCRIPT;
    await this.runPowerShell(script, {
      PRISM_SENDINPUT_VK: String(parsed.vk),
      PRISM_SENDINPUT_MODIFIERS: parsed.modifiers.map((m) => String(m)).join(","),
    });
    return { ok: true, output: { key, vk: parsed.vk, modifiers: parsed.modifiers, backend: "Win32.SendInput" } };
  }

  private async handleCursorPosition(): Promise<ToolResult> {
    if (this.nonWin32Backend) {
      const pos = await this.nonWin32Backend.cursorPosition();
      return { ok: true, output: { x: pos.x, y: pos.y, backend: this.nonWin32Backend.id } };
    }
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $pos = [System.Windows.Forms.Cursor]::Position
      Write-Output "$($pos.X),$($pos.Y)"
    `;
    const { stdout } = await this.runPowerShell(script);
    const [x, y] = stdout.trim().split(",").map(Number);
    return { ok: true, output: { x, y } };
  }

  private async runPowerShell(
    script: string,
    extraEnv: Record<string, string> = {},
  ): Promise<{ stdout: string; stderr: string }> {
    return await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
    ], {
      timeout: 10_000,
      env: { ...process.env, ...extraEnv },
    });
  }
}

/* ------------------------------------------------------------------------- */
/* Win32 SendInput PowerShell payloads                                        */
/* ------------------------------------------------------------------------- */

/**
 * PowerShell payload that P/Invokes user32!SendInput to type a Unicode string.
 * Reads the text from `$env:PRISM_SENDINPUT_TEXT` so the caller never has to
 * escape quotes, backticks, or newlines into a shell string.
 *
 * The INPUT structure is laid out per the Win32 documentation; we use the
 * keyboard variant (type=1) with KEYEVENTF_UNICODE (0x0004) and emit a paired
 * keydown / keyup for every codepoint. Code units in the surrogate pair range
 * are emitted verbatim so non-BMP characters are typed correctly.
 */
const SEND_INPUT_TYPE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PrismSendInput {
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION u;
    }
    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint KEYEVENTF_SCANCODE = 0x0008;
    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    public static int TypeUnicode(string text) {
        if (string.IsNullOrEmpty(text)) return 0;
        int n = text.Length;
        var inputs = new INPUT[n * 2];
        for (int i = 0; i < n; i++) {
            ushort code = (ushort)text[i];
            INPUT down = new INPUT { type = INPUT_KEYBOARD };
            down.u.ki = new KEYBDINPUT { wVk = 0, wScan = code, dwFlags = KEYEVENTF_UNICODE, time = 0, dwExtraInfo = IntPtr.Zero };
            INPUT up = new INPUT { type = INPUT_KEYBOARD };
            up.u.ki = new KEYBDINPUT { wVk = 0, wScan = code, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
            inputs[i * 2] = down;
            inputs[i * 2 + 1] = up;
        }
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        return (int)sent;
    }
    public static int PressKey(ushort vk, ushort[] modifierVks) {
        int total = (modifierVks == null ? 0 : modifierVks.Length) * 2 + 2;
        var inputs = new INPUT[total];
        int idx = 0;
        if (modifierVks != null) {
            for (int i = 0; i < modifierVks.Length; i++) {
                INPUT down = new INPUT { type = INPUT_KEYBOARD };
                down.u.ki = new KEYBDINPUT { wVk = modifierVks[i], wScan = 0, dwFlags = 0, time = 0, dwExtraInfo = IntPtr.Zero };
                inputs[idx++] = down;
            }
        }
        INPUT keyDown = new INPUT { type = INPUT_KEYBOARD };
        keyDown.u.ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = 0, time = 0, dwExtraInfo = IntPtr.Zero };
        inputs[idx++] = keyDown;
        INPUT keyUp = new INPUT { type = INPUT_KEYBOARD };
        keyUp.u.ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
        inputs[idx++] = keyUp;
        if (modifierVks != null) {
            for (int i = modifierVks.Length - 1; i >= 0; i--) {
                INPUT up = new INPUT { type = INPUT_KEYBOARD };
                up.u.ki = new KEYBDINPUT { wVk = modifierVks[i], wScan = 0, dwFlags = KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
                inputs[idx++] = up;
            }
        }
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        return (int)sent;
    }
}
"@
$text = [System.Environment]::GetEnvironmentVariable('PRISM_SENDINPUT_TEXT')
if ($null -eq $text) { $text = '' }
$sent = [PrismSendInput]::TypeUnicode($text)
Write-Output "sent=$sent expected=$($text.Length * 2)"
`;

const SEND_INPUT_KEY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PrismSendInputKey {
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION u; }
    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    public static int PressKey(ushort vk, ushort[] modifierVks) {
        int total = (modifierVks == null ? 0 : modifierVks.Length) * 2 + 2;
        var inputs = new INPUT[total];
        int idx = 0;
        if (modifierVks != null) {
            for (int i = 0; i < modifierVks.Length; i++) {
                INPUT down = new INPUT { type = INPUT_KEYBOARD };
                down.u.ki = new KEYBDINPUT { wVk = modifierVks[i], wScan = 0, dwFlags = 0, time = 0, dwExtraInfo = IntPtr.Zero };
                inputs[idx++] = down;
            }
        }
        INPUT keyDown = new INPUT { type = INPUT_KEYBOARD };
        keyDown.u.ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = 0, time = 0, dwExtraInfo = IntPtr.Zero };
        inputs[idx++] = keyDown;
        INPUT keyUp = new INPUT { type = INPUT_KEYBOARD };
        keyUp.u.ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
        inputs[idx++] = keyUp;
        if (modifierVks != null) {
            for (int i = modifierVks.Length - 1; i >= 0; i--) {
                INPUT up = new INPUT { type = INPUT_KEYBOARD };
                up.u.ki = new KEYBDINPUT { wVk = modifierVks[i], wScan = 0, dwFlags = KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
                inputs[idx++] = up;
            }
        }
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        return (int)sent;
    }
}
"@
$vk = [uint16]([System.Environment]::GetEnvironmentVariable('PRISM_SENDINPUT_VK'))
$modText = [System.Environment]::GetEnvironmentVariable('PRISM_SENDINPUT_MODIFIERS')
$mods = @()
if ($modText) { $mods = $modText.Split(',') | ForEach-Object { [uint16]$_ } }
$sent = [PrismSendInputKey]::PressKey($vk, $mods)
Write-Output "sent=$sent"
`;

/* ------------------------------------------------------------------------- */
/* Virtual-key code table (Win32 VK_*)                                        */
/* https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes */
/* ------------------------------------------------------------------------- */

const VK: Record<string, number> = {
  backspace: 0x08, tab: 0x09, clear: 0x0c, enter: 0x0d, return: 0x0d,
  shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, menu: 0x12,
  pause: 0x13, capslock: 0x14, escape: 0x1b, esc: 0x1b, space: 0x20,
  pageup: 0x21, page_up: 0x21, pagedown: 0x22, page_down: 0x22,
  end: 0x23, home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  select: 0x29, print: 0x2a, execute: 0x2b, printscreen: 0x2c,
  insert: 0x2d, delete: 0x2e, del: 0x2e, help: 0x2f,
  win: 0x5b, lwin: 0x5b, rwin: 0x5c, apps: 0x5d,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
  f13: 0x7c, f14: 0x7d, f15: 0x7e, f16: 0x7f, f17: 0x80, f18: 0x81,
  f19: 0x82, f20: 0x83, f21: 0x84, f22: 0x85, f23: 0x86, f24: 0x87,
  numlock: 0x90, scrolllock: 0x91, scroll_lock: 0x91,
  lshift: 0xa0, rshift: 0xa1, lctrl: 0xa2, rctrl: 0xa3, lalt: 0xa4, ralt: 0xa5,
};

interface ParsedChord { vk: number; modifiers: number[]; }

function parseKeyChord(input: string): ParsedChord | null {
  const raw = input.trim();
  if (!raw) return null;
  // Support both "ctrl+shift+escape" and SendKeys-style "^+{ESC}" notation.
  const sendKeysPrefix: Record<string, number> = { "^": VK.ctrl, "+": VK.shift, "%": VK.alt };
  const modifiers: number[] = [];
  let rest = raw;
  while (rest.length > 0 && sendKeysPrefix[rest[0]] !== undefined) {
    modifiers.push(sendKeysPrefix[rest[0]]);
    rest = rest.slice(1);
  }
  // Strip surrounding {} from SendKeys-style key names ("{ENTER}").
  if (rest.startsWith("{") && rest.endsWith("}")) {
    rest = rest.slice(1, -1);
  }
  // "ctrl+shift+escape" form
  if (rest.includes("+") || rest.includes("-")) {
    const parts = rest.split(/[+\-]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const main = parts.pop() as string;
    for (const part of parts) {
      const mod = VK[part.toLowerCase()];
      if (mod === undefined) return null;
      modifiers.push(mod);
    }
    rest = main;
  }
  const lower = rest.toLowerCase();
  let vk: number | undefined = VK[lower];
  if (vk === undefined && rest.length === 1) {
    const ch = rest.toUpperCase().charCodeAt(0);
    // 0-9 → VK 0x30-0x39, A-Z → VK 0x41-0x5A
    if ((ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a)) {
      vk = ch;
    }
  }
  if (vk === undefined) return null;
  return { vk, modifiers };
}
