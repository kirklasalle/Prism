import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import { FramebufferCapture } from "../../core/operator/framebuffer-capture.js";
import type { ToolContract } from "../../core/tools/contracts.js";

const execFileAsync = promisify(execFile);

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

  constructor(
    framebufferCapture?: FramebufferCapture
  ) {
    this.framebufferCapture = framebufferCapture ?? new FramebufferCapture();
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
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
    `;
    await this.runPowerShell(script);
    return { ok: true, output: { x, y } };
  }

  private async handleClick(button: "left" | "right" | "double"): Promise<ToolResult> {
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
    // Escape quotes for PowerShell
    const safeText = text.replace(/"/g, '`"');
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait("${safeText}")
    `;
    await this.runPowerShell(script);
    return { ok: true, output: { typed: text } };
  }

  private async handleKey(key: string): Promise<ToolResult> {
    // Anthropic keys often look like "Return", "Escape", etc.
    // SendKeys expects specific codes like "{ENTER}", "{ESC}"
    const keyMap: Record<string, string> = {
      "Return": "{ENTER}",
      "Enter": "{ENTER}",
      "Escape": "{ESC}",
      "Esc": "{ESC}",
      "Tab": "{TAB}",
      "Space": " ",
      "Backspace": "{BACKSPACE}",
      "Delete": "{DEL}",
      "Up": "{UP}",
      "Down": "{DOWN}",
      "Left": "{LEFT}",
      "Right": "{RIGHT}",
      "Page_Up": "{PGUP}",
      "Page_Down": "{PGDN}",
      "Home": "{HOME}",
      "End": "{END}",
      "F1": "{F1}", "F2": "{F2}", "F3": "{F3}", "F4": "{F4}", "F5": "{F5}", "F6": "{F6}",
      "F7": "{F7}", "F8": "{F8}", "F9": "{F9}", "F10": "{F10}", "F11": "{F11}", "F12": "{F12}",
    };

    const sendKey = keyMap[key] || key;
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait("${sendKey}")
    `;
    await this.runPowerShell(script);
    return { ok: true, output: { key: sendKey } };
  }

  private async handleCursorPosition(): Promise<ToolResult> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $pos = [System.Windows.Forms.Cursor]::Position
      Write-Output "$($pos.X),$($pos.Y)"
    `;
    const { stdout } = await this.runPowerShell(script);
    const [x, y] = stdout.trim().split(",").map(Number);
    return { ok: true, output: { x, y } };
  }

  private async runPowerShell(script: string): Promise<{ stdout: string; stderr: string }> {
    return await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
    ], { timeout: 10_000 });
  }
}
